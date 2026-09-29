import mysql from 'mysql2/promise';

export const pool = mysql.createPool({
    host: process.env.AWS_RDS_HOST,
    user: process.env.AWS_RDS_USER,
    password: process.env.AWS_RDS_PWD,
    database: process.env.AWS_RDS_DB || 'powerscribe',
    connectionLimit: 10,
});