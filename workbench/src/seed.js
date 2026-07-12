const { openDb, id } = require('./db');

function seed(db) {
  if (!db) {
    throw new Error('seed(db) requires an open database connection');
  }

  const insertAdmin = db.prepare(
    'insert or ignore into admin_users (id, display_name, access_code) values (?, ?, ?)'
  );
  const insertLearner = db.prepare(
    'insert or ignore into learners (id, nickname, access_code, grade) values (?, ?, ?, ?)'
  );

  insertAdmin.run(id('admin'), '点妈', 'admin-demo');
  insertLearner.run(id('learner'), 'Apple', 'apple-demo', '四年级');
  insertLearner.run(id('learner'), '果冻', 'guodong-demo', '四年级');
}

if (require.main === module) {
  const db = openDb();
  try {
    seed(db);
    console.log('Seeded workbench database.');
  } finally {
    db.close();
  }
}

module.exports = { seed };
