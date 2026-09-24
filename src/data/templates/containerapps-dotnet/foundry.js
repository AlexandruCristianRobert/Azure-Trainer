import { PROJECT_MANIFEST, SOLUTION_FILES } from './starter.js'

const api = 'src/Trainer.Api'
const project = `<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="OpenAI" Version="2.12.0" />
    <PackageReference Include="Azure.Identity" Version="1.21.0" />
  </ItemGroup>
</Project>
`

// This is a teaching source surface. The trainer parses the supported structure;
// it never executes learner C# or contacts a model.
export const FOUNDRY_PROGRAM = `using Azure.Identity;
using OpenAI;
using System.ClientModel.Primitives;
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
    using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(10));
    var credential = new ManagedIdentityCredential(clientId);
#pragma warning disable OPENAI001
    var client = new OpenAIClient(
        new BearerTokenPolicy(credential, "https://ai.azure.com/.default"),
        new OpenAIClientOptions { Endpoint = new Uri(endpoint), RetryPolicy = new ClientRetryPolicy(0), NetworkTimeout = TimeSpan.FromSeconds(3) }
    ).GetResponsesClient();
    var response = await client.CreateResponseAsync(deployment, text, cancellationToken: deadline.Token);
    return Results.Ok(new { summary = response.Value.GetOutputText(), deployment });
#pragma warning restore OPENAI001
});
app.Run("http://0.0.0.0:" + builder.Configuration["ListeningPort"]);

record SummarizeRequest(string Text);
`

const configuration = (endpoint, deployment) => `${JSON.stringify({ ListeningPort: 8080, FoundryEndpoint: endpoint,
  FoundryDeployment: deployment }, null, 2)}\n`

export const FOUNDRY_MANIFEST = Object.freeze({ ...PROJECT_MANIFEST, id: 'containerapps-dotnet-foundry-v1',
  fixedFiles: Object.freeze({ ...PROJECT_MANIFEST.fixedFiles, [`${api}/Trainer.Api.csproj`]: project,
    [`${api}/AppSettings.cs`]: SOLUTION_FILES[`${api}/AppSettings.cs`] }),
  foundry: true,
})
export const FOUNDRY_STARTER_FILES = Object.freeze({ ...SOLUTION_FILES,
  [`${api}/Trainer.Api.csproj`]: project, [`${api}/Program.cs`]: FOUNDRY_PROGRAM,
  [`${api}/appsettings.json`]: configuration('', ''),
})
export const FOUNDRY_SOLUTION_FILES = Object.freeze({ ...FOUNDRY_STARTER_FILES,
  [`${api}/appsettings.json`]: configuration('https://foundryguided.services.ai.azure.com/openai/v1/', 'summarizer-primary'),
})
