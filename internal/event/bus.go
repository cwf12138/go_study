package event

import (
	"context"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/example/studyflow/internal/platform"
)

type Event struct {
	ID          string         `json:"id"`
	Type        string         `json:"type"`
	ActorID     string         `json:"actor_id"`
	AggregateID string         `json:"aggregate_id,omitempty"`
	Data        map[string]any `json:"data,omitempty"`
	OccurredAt  time.Time      `json:"occurred_at"`
}

func New(eventType, actorID, aggregateID string, data map[string]any) Event {
	return Event{
		ID:          platform.NewID(),
		Type:        eventType,
		ActorID:     actorID,
		AggregateID: aggregateID,
		Data:        data,
		OccurredAt:  time.Now().UTC(),
	}
}

type Publisher interface {
	Publish(Event)
}

// Bus is an in-process fan-out event bus. Slow consumers cannot stall request
// handling; their own bounded queue drops events and exposes the drop count.
type Bus struct {
	mu          sync.RWMutex
	nextID      uint64
	subscribers map[uint64]chan Event
	dropped     atomic.Uint64
}

func NewBus() *Bus {
	return &Bus{subscribers: make(map[uint64]chan Event)}
}

func (b *Bus) Publish(evt Event) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	for _, subscriber := range b.subscribers {
		select {
		case subscriber <- evt:
		default:
			b.dropped.Add(1)
		}
	}
}

func (b *Bus) Subscribe(buffer int) (<-chan Event, func()) {
	if buffer < 1 {
		buffer = 1
	}
	b.mu.Lock()
	b.nextID++
	id := b.nextID
	channel := make(chan Event, buffer)
	b.subscribers[id] = channel
	b.mu.Unlock()

	var once sync.Once
	cancel := func() {
		once.Do(func() {
			b.mu.Lock()
			delete(b.subscribers, id)
			close(channel)
			b.mu.Unlock()
		})
	}
	return channel, cancel
}

func (b *Bus) Dropped() uint64 {
	return b.dropped.Load()
}

type Handler func(context.Context, Event) error

// RunWorkerPool fans work from one subscription across a fixed goroutine pool.
func RunWorkerPool(ctx context.Context, logger *slog.Logger, bus *Bus, workers int, handler Handler) {
	events, unsubscribe := bus.Subscribe(workers * 8)
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			for {
				select {
				case <-ctx.Done():
					return
				case evt, ok := <-events:
					if !ok {
						return
					}
					if err := handler(ctx, evt); err != nil {
						logger.Error("background event failed", "worker", workerID, "event_id", evt.ID, "event_type", evt.Type, "error", err)
					}
				}
			}
		}(i + 1)
	}
	<-ctx.Done()
	unsubscribe()
	wg.Wait()
}
