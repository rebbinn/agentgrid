package main

import (
	"testing"
	"time"
)

func TestKeepaliveReportsLatencyThenLost(t *testing.T) {
	overrideDuration(t, &keepaliveInterval, 50*time.Millisecond)
	overrideDuration(t, &keepaliveTimeout, 300*time.Millisecond)
	srv := startServer(t, serverOptions{password: serverPassword, keepaliveReplies: 3})
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})

	connectShell(t, h, srv, "s1", "app-01")
	latencies := 0
	for {
		event := h.next("s1", eventWait)
		switch event.str("ev") {
		case "latency":
			if ms, ok := event.num("ms"); !ok || ms < 0 {
				t.Fatalf("bad latency event %s", event)
			}
			latencies++
			continue
		case "closed":
			if event.str("reason") != reasonLost {
				t.Fatalf("got %s, want closed lost", event)
			}
		default:
			t.Fatalf("unexpected event %s", event)
		}
		break
	}
	if latencies != 3 {
		t.Fatalf("got %d latency events, want 3 (one per answered keepalive)", latencies)
	}
	if seen := srv.keepalivesSeen.Load(); seen < 4 {
		t.Fatalf("server saw %d keepalives, want at least 4", seen)
	}
}
