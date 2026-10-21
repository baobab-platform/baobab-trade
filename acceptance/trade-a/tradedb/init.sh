#!/bin/sh
# Trade's runtime role owns its database but is not a superuser: TA-08's
# posture check refuses a superuser role, which could skip every fence with
# session_replication_role = replica.
set -eu
psql -v ON_ERROR_STOP=1 -U postgres <<SQL
CREATE ROLE trade_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${TRADE_DB_PASSWORD}';
CREATE DATABASE baobab_trade_ta08 OWNER trade_runtime;
SQL
