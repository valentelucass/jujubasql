# SQL Server

O aplicativo usa o catálogo e as tabelas da instância selecionada. O backend consulta o catálogo e permite edição de células em tabelas autorizadas. O aplicativo não depende de migrações. Use uma conta de teste com acesso aos objetos e permissão `SELECT` nas tabelas autorizadas.

Para validar a navegação, escolha dois bancos existentes. Em um ambiente de testes isolado, use tabelas com FK simples, composta e autorreferente, além de uma FK cujo lado de origem tenha um índice único. Compare a tela Estrutura e cada aresta com os metadados exibidos no SSMS.
