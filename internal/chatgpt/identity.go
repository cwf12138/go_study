package chatgpt

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math/big"
	"strings"
	"time"
)

type identityClaims struct {
	Issuer          string          `json:"iss"`
	Subject         string          `json:"sub"`
	Email           string          `json:"email"`
	Audience        json.RawMessage `json:"aud"`
	AuthorizedParty string          `json:"azp"`
	Nonce           string          `json:"nonce"`
	Expiry          int64           `json:"exp"`
	NotBefore       int64           `json:"nbf"`
	IssuedAt        int64           `json:"iat"`
}
type jwk struct {
	ID   string `json:"kid"`
	Type string `json:"kty"`
	Use  string `json:"use"`
	Alg  string `json:"alg"`
	N    string `json:"n"`
	E    string `json:"e"`
}

func (m *Manager) verify(ctx context.Context, token, client, nonce string) (identityClaims, error) {
	var keys struct {
		Keys []jwk `json:"keys"`
	}
	if err := m.jsonRequest(ctx, "GET", issuer+"/.well-known/jwks.json", "", nil, &keys); err != nil {
		return identityClaims{}, err
	}
	return verifyIdentity(token, client, nonce, keys.Keys, time.Now())
}
func verifyIdentity(token, client, nonce string, keys []jwk, now time.Time) (identityClaims, error) {
	bad := errors.New("ChatGPT 身份令牌验证失败，请重新登录")
	var out identityClaims
	if len(token) > 32768 || nonce == "" || client == "" {
		return out, bad
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return out, bad
	}
	decode := base64.RawURLEncoding.DecodeString
	head, err := decode(parts[0])
	if err != nil {
		return out, bad
	}
	var h struct {
		Alg  string   `json:"alg"`
		ID   string   `json:"kid"`
		Crit []string `json:"crit"`
	}
	if json.Unmarshal(head, &h) != nil || h.Alg != "RS256" || h.ID == "" || len(h.Crit) > 0 {
		return out, bad
	}
	signature, err := decode(parts[2])
	if err != nil {
		return out, bad
	}
	hash := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	valid := false
	for _, key := range keys {
		if key.ID != h.ID || key.Type != "RSA" || (key.Use != "" && key.Use != "sig") || (key.Alg != "" && key.Alg != "RS256") {
			continue
		}
		n, ne := decode(key.N)
		e, ee := decode(key.E)
		if ne != nil || ee != nil || len(e) > 4 || len(e) == 0 {
			continue
		}
		exponent := 0
		for _, b := range e {
			exponent = exponent*256 + int(b)
		}
		modulus := new(big.Int).SetBytes(n)
		if modulus.BitLen() < 2048 || exponent < 3 || exponent%2 == 0 {
			continue
		}
		if rsa.VerifyPKCS1v15(&rsa.PublicKey{N: modulus, E: exponent}, crypto.SHA256, hash[:], signature) == nil {
			valid = true
			break
		}
	}
	if !valid {
		return out, bad
	}
	payload, err := decode(parts[1])
	if err != nil || json.Unmarshal(payload, &out) != nil {
		return identityClaims{}, bad
	}
	var audience string
	var audiences []string
	if json.Unmarshal(out.Audience, &audience) == nil {
		audiences = []string{audience}
	} else if json.Unmarshal(out.Audience, &audiences) != nil {
		return identityClaims{}, bad
	}
	matched := false
	for _, a := range audiences {
		if a == client {
			matched = true
		}
	}
	if !matched || len(audiences) > 1 && out.AuthorizedParty != client || out.AuthorizedParty != "" && out.AuthorizedParty != client || out.Issuer != issuer || out.Subject == "" || out.Nonce != nonce || out.Expiry <= now.Unix() || out.NotBefore > now.Unix()+30 || out.IssuedAt > now.Unix()+30 {
		return identityClaims{}, bad
	}
	return out, nil
}
