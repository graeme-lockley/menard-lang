#!/usr/bin/env bash
# Regenerate CONC-03 local TLS fixtures. Checked-in PEMs are the source of truth for CI.
set -euo pipefail
cd "$(dirname "$0")"
rm -f ca.key ca.crt localhost.key localhost.crt sni-a.key sni-a.crt sni-b.key sni-b.crt

openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days 3650 \
  -subj "/CN=Menard Test CA"

# localhost leaf (SAN localhost + 127.0.0.1)
openssl req -newkey rsa:2048 -nodes -keyout localhost.key -out localhost.csr \
  -subj "/CN=localhost"
cat > localhost.ext <<'EXT'
basicConstraints=CA:FALSE
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:localhost,IP:127.0.0.1
EXT
openssl x509 -req -in localhost.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out localhost.crt -days 3650 -extfile localhost.ext

# SNI leaf a.menard.test
openssl req -newkey rsa:2048 -nodes -keyout sni-a.key -out sni-a.csr \
  -subj "/CN=a.menard.test"
cat > sni-a.ext <<'EXT'
basicConstraints=CA:FALSE
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:a.menard.test
EXT
openssl x509 -req -in sni-a.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out sni-a.crt -days 3650 -extfile sni-a.ext

# SNI leaf b.menard.test (default server cert for dual-SNI tests)
openssl req -newkey rsa:2048 -nodes -keyout sni-b.key -out sni-b.csr \
  -subj "/CN=b.menard.test"
cat > sni-b.ext <<'EXT'
basicConstraints=CA:FALSE
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:b.menard.test
EXT
openssl x509 -req -in sni-b.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out sni-b.crt -days 3650 -extfile sni-b.ext

rm -f *.csr *.ext *.srl
echo "generated ca.crt localhost.{crt,key} sni-a.{crt,key} sni-b.{crt,key}"
