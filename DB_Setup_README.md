CREATE DATABASE meter_anomaly;

CREATE USER meter_user WITH PASSWORD 'meter_pass';

GRANT ALL PRIVILEGES ON DATABASE meter_anomaly TO meter_user;

\c meter_anomaly

GRANT USAGE, CREATE ON SCHEMA public TO meter_user;