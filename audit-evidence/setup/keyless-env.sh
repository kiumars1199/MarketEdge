# keyless = no app keys at all; only the sandbox's proxy + CA so next/font can reach Google Fonts at build time
KEYLESS="env -i PATH=$PATH HOME=$HOME HTTPS_PROXY=$HTTPS_PROXY https_proxy=$https_proxy NO_PROXY=$NO_PROXY no_proxy=$no_proxy NODE_EXTRA_CA_CERTS=$NODE_EXTRA_CA_CERTS NODE_OPTIONS=--use-openssl-ca SSL_CERT_FILE=$SSL_CERT_FILE"
