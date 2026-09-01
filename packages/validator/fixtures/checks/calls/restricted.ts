declare const db: { query(): void };
declare const methodName: string;

db.query();
db["query"]();
db[methodName]();
