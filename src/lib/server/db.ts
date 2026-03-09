import mssql from 'mssql';
const env = process.env;
const config: mssql.config = {
    server: env.MSSQL_HOST ?? 'localhost',
    port: Number(env.MSSQL_PORT ?? 1433),
    user: env.MSSQL_USER,
    password: env.MSSQL_PASSWORD,
    database: env.MSSQL_DATABASE ?? 'master',
    options: {
        encrypt: (env.MSSQL_ENCRYPT ?? 'false') == 'true',
        trustServerCertificate: (env.MSSQL_TRUST_SERVER_CERT ?? 'true') === 'true'
    }
};

let poolPromise: Promise<mssql.ConnectionPool> | null = null;

export const GetPool = async() => {
    if(!poolPromise) {
        poolPromise = mssql.connect(config).catch((error: unknown) => {
            poolPromise = null;
            throw error;
        })
    }
    return poolPromise
}