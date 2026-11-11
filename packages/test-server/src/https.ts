/**
 * A self-signed certificate for `startTestServer({ https: true })`, so TLS tests (untrusted
 * certificate → `tls` error; `strictSSL: false` → success) never depend on the network.
 *
 * Generated once and committed (ECDSA P-256, valid until 2126) for `localhost`, `127.0.0.1` and
 * `::1`. Not trusted by anything: that is the point. Regenerate with:
 *
 *   openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt > key.pem
 *   openssl req -x509 -new -key key.pem -sha256 -days 36500 -out cert.pem \
 *     -subj "/CN=Pigeon test server (self-signed)" \
 *     -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:0:0:0:0:0:0:0:1" \
 *     -addext "basicConstraints=critical,CA:FALSE" \
 *     -addext "keyUsage=critical,digitalSignature" -addext "extendedKeyUsage=serverAuth"
 *
 * The key is a test fixture only; it protects nothing.
 */

/** PEM certificate; pass it as a CA to trust the HTTPS test server. */
export const TEST_SERVER_CERT = `
-----BEGIN CERTIFICATE-----
MIIBszCCAVigAwIBAgIJAO+UDEOYYH0lMAoGCCqGSM49BAMCMCsxKTAnBgNVBAMM
IFBpZ2VvbiB0ZXN0IHNlcnZlciAoc2VsZi1zaWduZWQpMCAXDTI2MTExMDEzMzcz
MFoYDzIxMjYxMDE3MTMzNzMwWjArMSkwJwYDVQQDDCBQaWdlb24gdGVzdCBzZXJ2
ZXIgKHNlbGYtc2lnbmVkKTBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABFEvvzVE
bbjuvkqrlsy//boYC/yHPk+ocCF8NbXRwDWXacjbxB6xElWG0GQCnawlwhii/KCB
oDlDHoJ0e7LbcfyjYzBhMCwGA1UdEQQlMCOCCWxvY2FsaG9zdIcEfwAAAYcQAAAA
AAAAAAAAAAAAAAAAATAMBgNVHRMBAf8EAjAAMA4GA1UdDwEB/wQEAwIHgDATBgNV
HSUEDDAKBggrBgEFBQcDATAKBggqhkjOPQQDAgNJADBGAiEAr0MfRaJPnMmUb01d
1VYKlI7k2HtDiUeRk171/0hm5/cCIQDYkFUt/r036FenGnssaT2dWGJUrYhVX0lB
yxXm6UMhVg==
-----END CERTIFICATE-----
`.trimStart();

/** PEM private key (PKCS #8). */
export const TEST_SERVER_KEY = `
-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgTGbGKNGL0Clnfe2M
ppw1JVvq26o2mZM2PV+wMbZl6uOhRANCAARRL781RG247r5Kq5bMv/26GAv8hz5P
qHAhfDW10cA1l2nI28QesRJVhtBkAp2sJcIYovyggaA5Qx6CdHuy23H8
-----END PRIVATE KEY-----
`.trimStart();
