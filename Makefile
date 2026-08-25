.PHONY: run build test coverage fmt vet clean

run:
	go run ./cmd/api

build:
	go build -trimpath -o bin/studyflow ./cmd/api

test:
	go test -race ./...

coverage:
	go test -coverprofile=coverage.out ./...
	go tool cover -html=coverage.out

fmt:
	gofmt -w ./cmd ./internal

vet:
	go vet ./...

clean:
	go clean

