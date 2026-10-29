package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
)

// Error codes are part of the API contract; clients branch on them.
const (
	codeBadRequest         = "bad_request"
	codeUnauthorized       = "unauthorized"
	codeNotFound           = "not_found"
	codeUsernameTaken      = "username_taken"
	codeRegistrationClosed = "registration_closed"
	codeRateLimited        = "rate_limited"
	codePayloadTooLarge    = "payload_too_large"
	codeCursorReset        = "cursor_reset"
	codeInternal           = "internal"
)

type errorBody struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	var body errorBody
	body.Error.Code = code
	body.Error.Message = message
	writeJSON(w, status, body)
}

// decodeJSON strictly decodes the request body into v, writing the error response itself on failure.
func decodeJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	err := dec.Decode(v)
	if err == nil {
		if dec.Decode(&struct{}{}) != io.EOF {
			err = errors.New("unexpected data after JSON body")
		}
	}
	if err == nil {
		return true
	}
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		writeError(w, http.StatusRequestEntityTooLarge, codePayloadTooLarge, "Request body is too large")
		return false
	}
	writeError(w, http.StatusBadRequest, codeBadRequest, "Invalid JSON: "+err.Error())
	return false
}
