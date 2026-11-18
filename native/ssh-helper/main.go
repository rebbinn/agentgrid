package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
)

type pathList []string

func (p *pathList) String() string {
	return strings.Join(*p, ",")
}

func (p *pathList) Set(value string) error {
	*p = append(*p, value)
	return nil
}

func parseOptions(args []string, stderr io.Writer) (options, error) {
	flags := flag.NewFlagSet("agentgrid-ssh", flag.ContinueOnError)
	flags.SetOutput(stderr)
	knownHostsFile := flags.String("known-hosts", "", "AgentGrid's own known_hosts file (read and appended to)")
	var extraFiles pathList
	flags.Var(&extraFiles, "extra-known-hosts", "read-only known_hosts file; may be repeated")
	if err := flags.Parse(args); err != nil {
		return options{}, err
	}
	if *knownHostsFile == "" {
		return options{}, errors.New("--known-hosts is required")
	}
	return options{knownHostsFile: *knownHostsFile, extraKnownHostsFiles: extraFiles}, nil
}

func main() {
	opts, err := parseOptions(os.Args[1:], os.Stderr)
	if err != nil {
		fmt.Fprintln(os.Stderr, "agentgrid-ssh:", err)
		os.Exit(2)
	}
	newHelper(opts, os.Stdout, os.Stderr).run(os.Stdin)
}
