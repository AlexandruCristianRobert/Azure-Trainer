import { FOUNDRY_MANIFEST, FOUNDRY_STARTER_FILES } from './foundry.js'

const api = 'src/Trainer.Api'

// The trainer accepts this supported source structure and bounded settings only.
// It parses source; it never executes learner code or contacts a model.
export const TROUBLESHOOTING_FOUNDRY_PROGRAM = `using Azure.Identity;
using OpenAI;
using System.ClientModel;
using System.ClientModel.Primitives;
using System.Diagnostics;
using Trainer.Api;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();
app.MapGet("/api/info", () => Results.Ok(new { service = AppSettings.ServiceName, environment = builder.Configuration["APP_ENV"] }));
app.MapPost("/api/summarize", async (SummarizeRequest request) => {
    var text = request?.Text?.Trim();
    if (string.IsNullOrWhiteSpace(text) || text.Length > 4000)
        return Results.BadRequest(new { error = "Text is required and must be at most 4000 characters." });
    var endpoint = builder.Configuration["FoundryEndpoint"];
    var deployment = builder.Configuration["FoundryDeployment"];
    var clientId = builder.Configuration["AZURE_CLIENT_ID"];
    if (string.IsNullOrWhiteSpace(endpoint) || string.IsNullOrWhiteSpace(deployment) || string.IsNullOrWhiteSpace(clientId))
        return Results.StatusCode(503);
    var maxAttempts = builder.Configuration.GetValue<int>("TotalAttempts");
    var totalBudgetSeconds = builder.Configuration.GetValue<int>("TotalBudgetSeconds");
    var attemptTimeoutSeconds = builder.Configuration.GetValue<int>("AttemptTimeoutSeconds");
    var honorRetryAfter = builder.Configuration.GetValue<bool>("HonorRetryAfter");
    if (maxAttempts < 1 || maxAttempts > 3 || totalBudgetSeconds < 1 || totalBudgetSeconds > 10 ||
        attemptTimeoutSeconds < 1 || attemptTimeoutSeconds > 3 || attemptTimeoutSeconds > totalBudgetSeconds)
        return Results.StatusCode(503);
    using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(totalBudgetSeconds));
    var clock = Stopwatch.StartNew();
    var credential = new ManagedIdentityCredential(clientId);
#pragma warning disable OPENAI001
    var client = new OpenAIClient(
        new BearerTokenPolicy(credential, "https://ai.azure.com/.default"),
        new OpenAIClientOptions { Endpoint = new Uri(endpoint), RetryPolicy = new ClientRetryPolicy(0), NetworkTimeout = TimeSpan.FromSeconds(attemptTimeoutSeconds) }
    ).GetResponsesClient();
    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
        var remaining = TimeSpan.FromSeconds(totalBudgetSeconds) - clock.Elapsed;
        if (remaining <= TimeSpan.Zero) return Results.StatusCode(504);
        using var attemptDeadline = CancellationTokenSource.CreateLinkedTokenSource(deadline.Token);
        attemptDeadline.CancelAfter(TimeSpan.FromSeconds(attemptTimeoutSeconds) < remaining
            ? TimeSpan.FromSeconds(attemptTimeoutSeconds) : remaining);
        try {
            var response = await client.CreateResponseAsync(deployment, text, cancellationToken: attemptDeadline.Token);
            return Results.Ok(new { summary = response.Value.GetOutputText(), deployment });
        }
        catch (ClientResultException error) when (error.Status is 408 or 429 or 500 or 502 or 503 or 504) {
            if (attempt == maxAttempts) return Results.StatusCode(503);
            var fallback = TimeSpan.FromSeconds(attempt);
            var delay = fallback;
            var raw = error.GetRawResponse();
            if (honorRetryAfter && raw?.Headers.TryGetValue("Retry-After", out var header) == true &&
                int.TryParse(header, out var seconds) && seconds >= 0 &&
                TimeSpan.FromSeconds(seconds) < TimeSpan.FromSeconds(totalBudgetSeconds) - clock.Elapsed)
                delay = TimeSpan.FromSeconds(seconds);
            if (delay >= TimeSpan.FromSeconds(totalBudgetSeconds) - clock.Elapsed) return Results.StatusCode(504);
            try { await Task.Delay(delay, deadline.Token); }
            catch (OperationCanceledException) { return Results.StatusCode(504); }
        }
        catch (OperationCanceledException) when (attemptDeadline.IsCancellationRequested) {
            if (deadline.IsCancellationRequested || attempt == maxAttempts) return Results.StatusCode(504);
            var delay = TimeSpan.FromSeconds(attempt);
            if (delay >= TimeSpan.FromSeconds(totalBudgetSeconds) - clock.Elapsed) return Results.StatusCode(504);
            try { await Task.Delay(delay, deadline.Token); }
            catch (OperationCanceledException) { return Results.StatusCode(504); }
        }
        catch (ClientResultException) { return Results.StatusCode(502); }
    }
    return Results.StatusCode(503);
#pragma warning restore OPENAI001
});
app.Run("http://0.0.0.0:" + builder.Configuration["ListeningPort"]);

record SummarizeRequest(string Text);
`

export const TROUBLESHOOTING_FOUNDRY_MANIFEST = Object.freeze({ ...FOUNDRY_MANIFEST,
  id: 'containerapps-dotnet-foundry-troubleshooting-v1', foundryTroubleshooting: true })

export const TROUBLESHOOTING_FOUNDRY_STARTER_FILES = Object.freeze({ ...FOUNDRY_STARTER_FILES,
  [`${api}/Program.cs`]: TROUBLESHOOTING_FOUNDRY_PROGRAM,
  [`${api}/appsettings.json`]: `${JSON.stringify({ ListeningPort: 8080,
    FoundryEndpoint: 'https://foundrywrong.services.ai.azure.com/openai/v1/',
    FoundryDeployment: 'summarizer-missing', TotalAttempts: 1, TotalBudgetSeconds: 10,
    AttemptTimeoutSeconds: 3, HonorRetryAfter: false }, null, 2)}\n`,
})
