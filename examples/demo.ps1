$ErrorActionPreference = "Stop"
$baseUrl = if ($env:STUDYFLOW_URL) { $env:STUDYFLOW_URL } else { "http://localhost:8080" }
$email = "learner-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())@example.com"

$auth = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/v1/auth/register" -ContentType "application/json" -Body (@{
    name = "Go Learner"
    email = $email
    password = "learn-go-safely-123"
} | ConvertTo-Json)
$headers = @{ Authorization = "Bearer $($auth.data.token)" }

$goal = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/v1/goals" -Headers $headers -ContentType "application/json" -Body (@{
    title = "Master Go backend engineering"
    description = "Extend StudyFlow with production adapters"
    target_minutes = 1200
} | ConvertTo-Json)

$task = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/v1/tasks" -Headers $headers -ContentType "application/json" -Body (@{
    goal_id = $goal.data.id
    title = "Understand event bus concurrency"
    description = "Read the code and add a durable messaging adapter"
    estimated_minutes = 90
    priority = "high"
    tags = @("go", "concurrency", "events")
} | ConvertTo-Json)

$deck = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/v1/decks" -Headers $headers -ContentType "application/json" -Body (@{
    name = "Go core concepts"
    description = "Build knowledge through active recall"
} | ConvertTo-Json)

$card = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/v1/decks/$($deck.data.id)/cards" -Headers $headers -ContentType "application/json" -Body (@{
    prompt = "When does a send on an unbuffered channel complete?"
    answer = "When another goroutine has received the value."
} | ConvertTo-Json)

$review = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/v1/cards/$($card.data.id)/reviews" -Headers $headers -ContentType "application/json" -Body (@{
    rating = 3
} | ConvertTo-Json)

$focus = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/v1/focus-sessions" -Headers $headers -ContentType "application/json" -Body (@{
    task_id = $task.data.id
    planned_minutes = 25
} | ConvertTo-Json)

$finished = Invoke-RestMethod -Method Patch -Uri "$baseUrl/api/v1/focus-sessions/$($focus.data.id)/finish" -Headers $headers -ContentType "application/json" -Body (@{
    abandoned = $false
} | ConvertTo-Json)

$dashboard = Invoke-RestMethod -Method Get -Uri "$baseUrl/api/v1/dashboard" -Headers $headers
[PSCustomObject]@{
    User = $auth.data.user.email
    Goal = $goal.data.title
    Task = $task.data.title
    NextReview = $review.data.review.next_due_at
    FocusStatus = $finished.data.status
    Dashboard = $dashboard.data
} | Format-List
