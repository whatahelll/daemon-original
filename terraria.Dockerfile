FROM mono:latest

RUN apt-get update && apt-get install -y \
    wget \
    unzip \
    gosu \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd -g 1000 container && \
    useradd -u 1000 -g 1000 -d /home/container -s /bin/bash container

RUN mkdir -p /home/container && \
    chown -R container:container /home/container && \
    chmod -R 755 /home/container

COPY terraria-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /home/container
USER root

ENTRYPOINT ["/entrypoint.sh"]