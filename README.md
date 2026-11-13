# JujubaSQL

<img src="frontend/src/assets/jujuba.png" alt="Mascote do JujubaSQL" width="112" />

Aplicativo desktop Windows para consultar bancos de uma instância do SQL Server. O Tauri abre a interface React e executa as consultas e alterações autorizadas no backend Rust local.

## Instalar e conectar

1. Execute o instalador x64 do JujubaSQL. O aplicativo usa o runtime gratuito Microsoft Edge WebView2. O instalador pode baixar o runtime se ele ainda não estiver no Windows.
2. Abra o JujubaSQL pelo menu Iniciar e selecione **Conectar**.
3. Se o SQL Server estiver no mesmo Windows, selecione **Neste computador**. Deixe **Instância local** em branco para a instância padrão. Esse modo usa a memória compartilhada do Windows e requer o Microsoft ODBC Driver 18 ou 17 para SQL Server, x64.
4. Para outro computador, selecione **Pela rede** e informe o nome DNS e a porta TCP do servidor. Use a rede privada ou a VPN, se aplicável. O certificado precisa corresponder ao DNS e ser confiável no Windows. Nos dois modos, escolha um usuário autorizado do SQL Server ou a conta atual do Windows. O JujubaSQL preenche os dados da última conexão bem-sucedida. A senha de SQL é solicitada a cada sessão.
5. Escolha um banco na lista pesquisável ou no explorador. Abra um esquema, a pasta **Tabelas** e uma tabela.

O login deve conseguir abrir o catálogo `master` para descobrir os bancos. Em cada banco, o SQL Server define quais objetos e registros o login pode consultar. A permissão `VIEW DEFINITION` nos objetos relevantes pode permitir classificar mais relações.

## Desenvolver e compilar

Requisitos no Windows x64:

- Node.js 22.12 ou superior e npm.
- Rust estável com o alvo `x86_64-pc-windows-msvc`.
- Microsoft C++ Build Tools com o Windows SDK e Microsoft Edge WebView2.

Na pasta do projeto, rode:

```powershell
Set-Location frontend
npm ci
npm run desktop -- dev
```

Para gerar o instalador:

```powershell
npm run desktop -- build
```

O pacote NSIS é gerado em `backend/rust/target/release/bundle/nsis/`. A entrega inicial usa um instalador x64 sem assinatura comercial. O pacote pode ser distribuído internamente conforme a política do Windows da empresa. Para executar os testes Rust, rode `cargo test --manifest-path backend/rust/Cargo.toml` a partir da raiz.

## Organização

- `frontend/src/models` define os tipos de catálogo, dados, conexão e relações. `controllers` coordena seleção, expansão e chamadas tipadas. `views` renderiza a interface Estúdio.
- `backend/rust/src` mantém os comandos Tauri, casos de uso e os adaptadores de catálogo, registros e conexões em `sql_server`. A ponte expõe comandos distintos para consulta SQL e edição de células. Na grade, os valores são parametrizados e os identificadores vêm do catálogo.
- `database` contém as instruções de validação com um banco existente ou isolado.

## Escopo da primeira versão

A árvore carrega os esquemas com tabelas visíveis e permite expandir as colunas. A grade pagina por 25, 50 ou 100 registros, filtra por trecho textual e ordena tipos compatíveis. Usa uma chave única visível quando possível para estabilizar a ordem. Valores textuais longos e binários são apresentados em prévia e valores CLR aparecem identificados como tal.

Selecione um banco para ver todas as tabelas e relações declaradas que o login consegue consultar. A aba Diagrama de uma tabela mostra as relações diretamente ligadas a ela, incluindo relações compostas e autorreferentes. Tabelas sem relações visíveis aparecem no grafo. Arraste os cartões das tabelas e os rótulos das relações para ajustar a visualização. A classificação usa a nulabilidade das colunas, a unicidade dos índices e a visibilidade dos metadados. O diagrama mostra a cardinalidade nas pontas da linha e explica os limites de cada lado no painel de detalhes. Quando a informação é insuficiente, a interface marca a cardinalidade como indeterminada.

## Consultar e editar

- **SQL** executa um único `SELECT` no banco escolhido. O editor aceita consultas com junções e CTEs e mostra até 200 linhas. O login deve ter as permissões de leitura exigidas pela consulta.
- Em **Dados → Editar células**, selecione uma célula compatível, informe o valor e revise a prévia antes de gravar. A edição exige permissão de `UPDATE`, chave primária compatível e confirmação. Se o valor original mudou, o JujubaSQL pede para atualizar a tabela. A primeira versão edita uma célula de texto ou de número inteiro por vez.
- Use uma conta com as permissões adequadas ao trabalho. Para testar gravações, use uma tabela autorizada em um banco de testes.

## Dashboards do banco

Selecione um banco e abra **Dashboards**. **Visão geral** mostra os objetos visíveis e a capacidade alocada nos arquivos. **Armazenamento** compara o espaço usado e reservado pelas maiores tabelas, incluindo seus índices. **Desempenho** consulta o Query Store do banco em períodos de 24 horas, 7 dias ou 30 dias, com duração média, volume e ranking pelo tempo acumulado.

Os painéis usam a conexão já aberta e as permissões do login. Estatísticas de partições e histórico podem exigir permissões adicionais de monitoramento. O JujubaSQL só consulta os metadados e o histórico disponível. A granularidade depende dos intervalos que o Query Store registrou.

## Validação na empresa

Para testar conexões pela rede, use um DNS coberto pelo certificado do servidor e um login autorizado. Na própria máquina do SQL Server, teste também a conexão por memória compartilhada.

Com a conexão aprovada, selecione `ETL_SISTEMA` e `ETL_SISTEMA_V2` se ambos estiverem acessíveis, ou dois bancos de teste autorizados. Abra uma tabela em cada banco, avance uma página, aplique filtro e ordenação e compare uma FK visível com o SSMS. Repita a conexão no PC pela rede privada ou VPN.

## Testes desta entrega

- Compilação TypeScript e Vite, binário Tauri x64 e pacote NSIS concluídos. A janela do JujubaSQL abriu no Windows e apresentou a tela de conexão.
- Três testes Rust locais passaram, cobrindo validação do nome do servidor e cardinalidade. Um teste separado com o conector Rust confirmou a rejeição de um certificado não confiável.
- O parser T-SQL do SSMS aceitou oito consultas de catálogo e leitura. O teste local da interface, com respostas de teste na ponte, passou para navegação por teclado, troca entre dois bancos, descarte de resposta obsoleta, paginação, ordenação, filtros, estrutura, permissões e FKs compostas e autorreferentes.
- A descoberta dos bancos e a abertura de tabelas pela conexão local foram verificadas no Windows. Valide o catálogo completo e eventuais gravações em um banco de teste autorizado.

## Referências

- [ByteTable, commit a56ee2d](https://github.com/Rezwanul-Haque/byteTable/tree/a56ee2db01389ae24fbb8b64a3ffddb13375ec45) para arquitetura, catálogo e grade.
- [VeloxDB, commit ed58ff7](https://github.com/veloxbase/veloxdb/tree/ed58ff79acba554dd56444e54f6cdca64dede246) para árvore e diagrama.
- [Tabularis SQL Server Plugin, commit 5e03e8d](https://github.com/TabularisDB/tabularis-sqlserver-plugin/blob/5e03e8dec3fe29169e716b78d8c63a0b5091a2c5/src/driver/pool.rs) para autenticação integrada e verificação TLS.
- [OpenMetadata](https://github.com/open-metadata/OpenMetadata) para catálogo e dependências. [HyperDX](https://github.com/hyperdxio/hyperdx) para controles de filtros e resultados. [Trigger.dev](https://github.com/triggerdotdev/trigger.dev) como referência para histórico de ETL.
- [Apache ECharts](https://github.com/apache/echarts-examples) para os gráficos de armazenamento e desempenho. [Grafana para SQL Server](https://github.com/grafana/grafana-mssql-datasource) como referência para séries temporais e filtros por período.
