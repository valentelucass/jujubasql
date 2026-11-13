use crate::{
    error::{AppError, Result},
    models::{Authentication, ConnectInput, Transport},
};
use std::{fmt::Write, ptr};
use windows_sys::Win32::{
    Foundation::{GetLastError, ERROR_NOT_FOUND},
    Security::Credentials::{
        CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE,
        CRED_TYPE_GENERIC,
    },
};
use zeroize::{Zeroize, Zeroizing};

pub struct PasswordKey(Vec<u16>);

impl PasswordKey {
    pub fn for_input(input: &ConnectInput) -> Option<Self> {
        if !matches!(input.authentication, Authentication::Sql) {
            return None;
        }
        let user = input.username.as_deref()?.trim();
        if user.is_empty() || user.encode_utf16().count() > 128 || user.contains('\0') {
            return None;
        }
        let endpoint = match input.transport {
            Transport::Network => {
                let host = input.host.trim().to_ascii_lowercase();
                if host.is_empty() || host.len() > 253 || host.contains('\0') || input.port == 0 {
                    return None;
                }
                format!("tcp/{host}/{}", input.port)
            }
            Transport::Local => {
                let mut instance = input.instance.as_deref().unwrap_or("").trim();
                if instance.eq_ignore_ascii_case("MSSQLSERVER") {
                    instance = "";
                }
                if instance.len() > 16 || instance.contains('\0') {
                    return None;
                }
                format!("local/{}", instance.to_ascii_lowercase())
            }
        };
        // Credential Manager compares target names case-insensitively. Encode the
        // SQL login so accounts that differ only by case still have distinct keys.
        let mut target = format!("JujubaSQL/sql/{endpoint}/");
        for byte in user.as_bytes() {
            write!(target, "{byte:02x}").expect("write into String");
        }
        Some(Self(target.encode_utf16().chain([0]).collect()))
    }

    pub fn exists(&self) -> Result<bool> {
        Ok(self.read_entry()?.is_some())
    }

    pub fn read(&self) -> Result<Option<Zeroizing<String>>> {
        self.read_entry()?
            .map(|entry| {
                let bytes = entry.blob();
                if bytes.is_empty() || bytes.len() > 512 {
                    return Err(vault_error());
                }
                String::from_utf8(bytes.to_vec())
                    .map(Zeroizing::new)
                    .map_err(|error| {
                        error.into_bytes().zeroize();
                        vault_error()
                    })
            })
            .transpose()
    }

    pub fn save(&self, password: &str) -> Result<()> {
        let mut blob = Zeroizing::new(password.as_bytes().to_vec());
        let mut target = self.0.clone();
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: target.as_mut_ptr(),
            CredentialBlobSize: blob.len() as u32,
            CredentialBlob: blob.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            ..Default::default()
        };
        // The target and blob remain alive until CredWriteW copies them.
        if unsafe { CredWriteW(&credential, 0) } == 0 {
            return Err(vault_error());
        }
        Ok(())
    }

    pub fn forget(&self) -> Result<()> {
        if unsafe { CredDeleteW(self.0.as_ptr(), CRED_TYPE_GENERIC, 0) } != 0
            || unsafe { GetLastError() } == ERROR_NOT_FOUND
        {
            return Ok(());
        }
        Err(vault_error())
    }

    fn read_entry(&self) -> Result<Option<Entry>> {
        let mut raw = ptr::null_mut();
        if unsafe { CredReadW(self.0.as_ptr(), CRED_TYPE_GENERIC, 0, &mut raw) } != 0
            && !raw.is_null()
        {
            return Ok(Some(Entry(raw)));
        }
        if unsafe { GetLastError() } == ERROR_NOT_FOUND {
            return Ok(None);
        }
        Err(vault_error())
    }
}

struct Entry(*mut CREDENTIALW);

impl Entry {
    fn blob(&self) -> &[u8] {
        // CredReadW owns the credential and its blob until CredFree.
        let entry = unsafe { &*self.0 };
        if entry.CredentialBlob.is_null() || entry.CredentialBlobSize == 0 {
            return &[];
        }
        unsafe {
            std::slice::from_raw_parts(entry.CredentialBlob, entry.CredentialBlobSize as usize)
        }
    }
}

impl Drop for Entry {
    fn drop(&mut self) {
        let entry = unsafe { &mut *self.0 };
        if !entry.CredentialBlob.is_null() && entry.CredentialBlobSize > 0 {
            unsafe {
                std::slice::from_raw_parts_mut(
                    entry.CredentialBlob,
                    entry.CredentialBlobSize as usize,
                )
            }
            .zeroize();
        }
        unsafe { CredFree(self.0.cast()) };
    }
}

fn vault_error() -> AppError {
    AppError::new(
        "credentials",
        "Não foi possível acessar o Gerenciador de Credenciais do Windows.",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_vault_remembers_and_forgets_only_the_matching_login() {
        let suffix = format!("credential-test-{}", std::process::id());
        let profile = |username: String, port| ConnectInput {
            host: "localhost.example".into(),
            port,
            transport: Transport::Network,
            instance: None,
            authentication: Authentication::Sql,
            username: Some(username),
            password: None,
        };
        let key = PasswordKey::for_input(&profile(suffix.clone(), 1433)).unwrap();
        let other_port = PasswordKey::for_input(&profile(suffix.clone(), 1444)).unwrap();
        let other_login = PasswordKey::for_input(&profile(suffix.to_uppercase(), 1433)).unwrap();
        key.forget().unwrap();
        assert!(!key.exists().unwrap());
        key.save("Dado fictício 漢").unwrap();
        let read = key.read();
        let other_port_exists = other_port.exists();
        let other_login_exists = other_login.exists();
        key.forget().unwrap();
        assert_eq!(
            read.unwrap().as_deref().map(String::as_str),
            Some("Dado fictício 漢")
        );
        assert!(!other_port_exists.unwrap());
        assert!(!other_login_exists.unwrap());
        assert!(!key.exists().unwrap());
    }
}
