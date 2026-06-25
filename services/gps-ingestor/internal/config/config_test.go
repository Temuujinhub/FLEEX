package config

import "testing"

func TestParseProtocolPortsDefault(t *testing.T) {
	// Empty value falls back to the legacy single Teltonika listener on tcpPort
	// so existing deployments are unchanged.
	got, err := parseProtocolPorts("", 5027)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if len(got) != 1 || got["teltonika"] != 5027 {
		t.Fatalf("default = %v", got)
	}
}

func TestParseProtocolPortsMulti(t *testing.T) {
	got, err := parseProtocolPorts("teltonika:5027, queclink:5028", 5027)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if got["teltonika"] != 5027 || got["queclink"] != 5028 {
		t.Fatalf("got = %v", got)
	}
}

func TestParseProtocolPortsErrors(t *testing.T) {
	cases := []string{
		"teltonika",                     // missing :port
		"teltonika:abc",                 // non-numeric port
		"teltonika:70000",               // out of range
		"teltonika:5027,teltonika:5028", // duplicate protocol
		":5027",                         // empty name
	}
	for _, c := range cases {
		if _, err := parseProtocolPorts(c, 5027); err == nil {
			t.Fatalf("expected error for %q", c)
		}
	}
}
