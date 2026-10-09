# pg_dump 17, matching the database (pgvector/pgvector:pg17), plus the AWS CLI for R2.
FROM postgres:17-alpine
RUN apk add --no-cache aws-cli
COPY backup/backup.sh /backup.sh
CMD ["/bin/sh", "/backup.sh"]
