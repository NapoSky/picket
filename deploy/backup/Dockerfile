FROM postgres:18-alpine
RUN apk add --no-cache age bash python3 coreutils util-linux
ARG PICKET_VERSION=unknown
ENV PICKET_VERSION=${PICKET_VERSION} BACKUP_DIR=/backups
WORKDIR /opt/picket-backup
COPY --chmod=755 run.sh ./run.sh
COPY retention.py schedule.py ./
USER postgres
ENTRYPOINT ["./run.sh"]
CMD ["schedule"]
