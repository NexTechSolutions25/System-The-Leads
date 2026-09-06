import { initDB, closeDB, databaseMessage } from "../src/db.js";
import { config } from "../src/config.js";
try {
  await initDB();
  console.log(
    `Conexão confirmada: ${config.dbDriver === "mysql" ? config.mysql.database : "SQLite"}. Estrutura preparada.`,
  );
} catch {
  console.error(databaseMessage());
  process.exitCode = 1;
} finally {
  await closeDB();
}
