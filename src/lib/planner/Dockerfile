# syntax=docker/dockerfile:1.7
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build

ENV DOTNET_CLI_TELEMETRY_OPTOUT=1
ENV DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1
ENV NUGET_XMLDOC_MODE=skip

RUN --mount=type=cache,target=/var/cache/apt --mount=type=cache,target=/var/lib/apt/lists \
    apt-get update && apt-get install -y --no-install-recommends git python3

WORKDIR /work

# Install TypeGen CLI and core inside the container
RUN --mount=type=cache,target=/root/.nuget/packages \
    dotnet tool install -g dotnet-typegen --version 2.5.2

# Install .NET 6 runtime required by TypeGen CLI (side-by-side with .NET 8)
ENV PATH="${PATH}:/root/.dotnet/tools"
RUN curl -sSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh \
    && bash /tmp/dotnet-install.sh --channel 6.0 --runtime dotnet --install-dir /usr/share/dotnet \
    && rm /tmp/dotnet-install.sh

# Install WebAssembly build tools
RUN --mount=type=cache,target=/root/.nuget/packages \
    dotnet workload install wasm-tools --skip-manifest-update

# Restore and publish
# Copy only the csproj to leverage Docker cache for dependencies
COPY --link FluidHtnWasm.csproj /work/app/
RUN --mount=type=cache,target=/root/.nuget/packages \
    dotnet restore /work/app/FluidHtnWasm.csproj

# Get Fluid HTN source (after restore to avoid invalidating deps cache when ref changes)
ARG FLUIDHTN_REF=master
RUN git clone --depth 1 --filter=blob:none --branch ${FLUIDHTN_REF} https://github.com/ptrefall/fluid-hierarchical-task-network /work/fluid-hierarchical-task-network

# Now copy the rest of the app sources (the hot path)
COPY --link ./ /work/app/
ARG AOT=false
RUN --mount=type=cache,target=/root/.nuget/packages \
    --mount=type=cache,target=/work/app/obj \
    dotnet publish -c Release -o /out /work/app/FluidHtnWasm.csproj -p:RunAOTCompilation=${AOT} --no-restore

# Generate TypeScript types from C# using TypeGen after publish (source exists in /work/app)
WORKDIR /work/app
RUN dotnet-typegen generate || dotnet typegen generate || true

# Move generated types to a predictable export path next to AppBundle
RUN mkdir -p /out/generated/fluidhtn && \
    if [ -d "/work/gen/types/fluidhtn" ]; then cp -r /work/gen/types/fluidhtn/* /out/generated/fluidhtn/; fi

FROM scratch AS export
COPY --from=build /work/app/bin/Release/net8.0/browser-wasm/AppBundle/ .
COPY --from=build /out/generated/ ./generated/
