const api = 'src/Trainer.Api'

const projectFile = `<Project Sdk="Microsoft.NET.Sdk.Web">\n  <PropertyGroup>\n    <TargetFramework>net10.0</TargetFramework>\n    <ImplicitUsings>enable</ImplicitUsings>\n  </PropertyGroup>\n</Project>\n`
const settingsFile = `namespace Trainer.Api;\n\npublic static class AppSettings\n{\n    public const string ServiceName = "contoso-api";\n}\n`
const configFile = '{\n  "ListeningPort": 8080\n}\n'
const ignored = 'bin/\nobj/\n'

const source = `using Trainer.Api;\nvar builder = WebApplication.CreateBuilder(args);\nvar app = builder.Build();\napp.MapGet("/api/info", () => Results.Ok(new { service = AppSettings.ServiceName, environment = builder.Configuration["APP_ENV"] }));\napp.Run("http://0.0.0.0:" + builder.Configuration["ListeningPort"]);\n`
const starterSource = source.replace('service = AppSettings.ServiceName', 'service = "replace-service-name"')

const dockerfile = `FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build\nWORKDIR /src\nCOPY src/Trainer.Api/Trainer.Api.csproj src/Trainer.Api/\nRUN dotnet restore src/Trainer.Api/Trainer.Api.csproj\nCOPY . .\nRUN dotnet publish src/Trainer.Api/Trainer.Api.csproj -c Release -o /app/publish\nFROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final\nWORKDIR /app\nENV ASPNETCORE_HTTP_PORTS=8080\nCOPY --from=build /app/publish .\nENTRYPOINT ["dotnet", "Trainer.Api.dll"]\n`

export const PROJECT_MANIFEST = Object.freeze({
  id: 'containerapps-dotnet-v1',
  files: [
    `${api}/Trainer.Api.csproj`, `${api}/Program.cs`, `${api}/AppSettings.cs`,
    `${api}/appsettings.json`, 'Dockerfile', '.dockerignore',
  ],
  fixedFiles: Object.freeze({ [`${api}/Trainer.Api.csproj`]: projectFile, '.dockerignore': ignored }),
  maxFiles: 32,
  maxFileBytes: 32 * 1024,
  maxTotalBytes: 256 * 1024,
  maxTokens: 5000,
})

export const SOLUTION_FILES = Object.freeze({
  [`${api}/Trainer.Api.csproj`]: projectFile,
  [`${api}/Program.cs`]: source,
  [`${api}/AppSettings.cs`]: settingsFile,
  [`${api}/appsettings.json`]: configFile,
  Dockerfile: dockerfile,
  '.dockerignore': ignored,
})

export const STARTER_FILES = Object.freeze({
  ...SOLUTION_FILES,
  [`${api}/Program.cs`]: starterSource,
  Dockerfile: dockerfile.replace('ENTRYPOINT ["dotnet", "Trainer.Api.dll"]', 'ENTRYPOINT ["dotnet", "replace-me.dll"]'),
})
