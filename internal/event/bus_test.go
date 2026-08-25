package event

import "testing"

func TestBusFanOutAndUnsubscribe(t *testing.T) {
	bus := NewBus()
	first, cancelFirst := bus.Subscribe(1)
	second, cancelSecond := bus.Subscribe(1)
	defer cancelSecond()
	evt := New("test.happened", "u1", "a1", nil)
	bus.Publish(evt)
	if got := <-first; got.ID != evt.ID {
		t.Fatalf("first subscriber got %q, want %q", got.ID, evt.ID)
	}
	if got := <-second; got.ID != evt.ID {
		t.Fatalf("second subscriber got %q, want %q", got.ID, evt.ID)
	}
	cancelFirst()
	if _, open := <-first; open {
		t.Fatal("subscriber channel remains open after cancel")
	}
}
