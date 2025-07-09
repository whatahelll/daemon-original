FROM ghcr.io/pterodactyl/yolks:java_21

RUN apt-get update && apt-get install -y gosu && rm -rf /var/lib/apt/lists/*

RUN groupadd -g 1000 container && \
    useradd -u 1000 -g 1000 -d /home/container -s /bin/bash container

RUN mkdir -p /home/container && \
    chown -R container:container /home/container && \
    chmod -R 755 /home/container

COPY minecraft-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /home/container
USER root

ENTRYPOINT ["/entrypoint.sh"]