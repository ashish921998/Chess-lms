-- Separate test database for isolated test runs (TEST_DATABASE_URL).
CREATE DATABASE chess_test;
GRANT ALL PRIVILEGES ON DATABASE chess_test TO chess;
