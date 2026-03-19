// require('dotenv').config();
// const mssql = require('mssql');

// const config = {
//   server: 'localhost',
//   port: 1433,
//   user: process.env.SOURCE_DB_USER,
//   password: process.env.SOURCE_DB_PASSWORD,
//   database: process.env.SOURCE_DB_NAME,
//   options: {
//     encrypt: false,
//     trustServerCertificate: true,
//   }
// };

// console.log('Config utilisée:', {
//   server: config.server,
//   port: config.port,
//   user: config.user,
//   password: config.password ? '***' + config.password.slice(-3) : 'VIDE',
//   database: config.database,
// });

// mssql.connect(config)
//   .then(() => console.log('✅ Connexion réussie !'))
//   .catch(err => console.error('❌ Erreur:', err.message));

const mssql = require('mssql');

const config = {
  server: 'localhost',
  port: 1433,
 user: 'spuissance',
password: 'Test1234!',
//   database: 'backup_usine',
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
  },
  authentication: {
    type: 'default',
    options: {
      userName: 'spuissance',
      password: 'Test1234!',
    }
  }
};

console.log('Tentative de connexion...');

mssql.connect(config)
  .then(() => {
    console.log('✅ Connexion réussie !');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Erreur complète:', err);
    process.exit(1);
  });