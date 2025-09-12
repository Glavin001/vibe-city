using System;
using System.Collections.Generic;
using System.Runtime.InteropServices.JavaScript;
using FluidHTN;
using FluidHTN.Contexts;
using FluidHTN.Compounds;
using FluidHTN.Factory;
using FluidHTN.Debug;
using TaskStatus = FluidHTN.TaskStatus;
using System.Text.Json;
using System.IO;
using System.Text;

namespace FluidHtnWasm;

public static partial class PlannerBridge
{
    private static bool s_DebugPlanner = false;

    [JSExport]
    public static void EnablePlannerDebug(bool enabled)
    {
        s_DebugPlanner = enabled;
    }

    private static void DebugLog(BunkerContext c, string message)
    {
        if (s_DebugPlanner)
        {
            c.Steps.Add($"# {message}");
        }
    }
    [JSExport]
    public static string RunDemo()
    {
        var ctx = new MyContext();
        var planner = new Planner<MyContext>();
        ctx.Init();

        var executedTaskNames = new List<string>();

        var domain = new DomainBuilder<MyContext>("DemoDomain")
            .Select("Get C if A and B")
                .Condition("Has A and B", c => c.HasState(MyWorldState.HasA) && c.HasState(MyWorldState.HasB))
                .Condition("Does not have C", c => !c.HasState(MyWorldState.HasC))
                .Action("Get C")
                    .Do(c => { executedTaskNames.Add("Get C"); return TaskStatus.Success; })
                    .Effect("Set C", EffectType.PlanAndExecute, (c, type) => c.SetState(MyWorldState.HasC, true, type))
                .End()
            .End()
            .Sequence("Ensure A then B")
                .Condition("Missing A or B", c => !(c.HasState(MyWorldState.HasA) && c.HasState(MyWorldState.HasB)))
                .Action("Get A")
                    .Do(c => { executedTaskNames.Add("Get A"); return TaskStatus.Success; })
                    .Effect("Set A", EffectType.PlanAndExecute, (c, type) => c.SetState(MyWorldState.HasA, true, type))
                .End()
                .Action("Get B")
                    .Condition("Has A", c => c.HasState(MyWorldState.HasA))
                    .Do(c => { executedTaskNames.Add("Get B"); return TaskStatus.Success; })
                    .Effect("Set B", EffectType.PlanAndExecute, (c, type) => c.SetState(MyWorldState.HasB, true, type))
                .End()
            .End()
            .Select("Done")
                .Action("Done")
                    .Do(c => { executedTaskNames.Add("Done"); c.Done = true; return TaskStatus.Continue; })
                .End()
            .End()
            .Build();

        {
            var guard = 0;
            const int MAX_TICKS = 10000;
            while (!ctx.Done && guard++ < MAX_TICKS)
            {
                planner.Tick(domain, ctx);
            }
            if (!ctx.Done)
            {
                ctx.Done = true;
            }
        }

        return string.Join(",", executedTaskNames);
    }

    public enum MyWorldState : byte { HasA, HasB, HasC }

    public class MyContext : BaseContext
    {
        public override List<string>? MTRDebug { get; set; }
        public override List<string>? LastMTRDebug { get; set; }
        public override bool DebugMTR { get; } = false;
        public override Queue<IBaseDecompositionLogEntry>? DecompositionLog { get; set; }
        public override bool LogDecomposition { get; } = false;

        public override IFactory Factory { get; protected set; } = new DefaultFactory();
        public override IPlannerState PlannerState { get; protected set; } = new DefaultPlannerState();

        private readonly byte[] _world = new byte[Enum.GetValues(typeof(MyWorldState)).Length];
        public override byte[] WorldState => _world;

        public bool Done { get; set; }

        public override void Init() => base.Init();

        public bool HasState(MyWorldState state) => HasState((int)state, 1);
        public void SetState(MyWorldState state, bool value, EffectType type)
            => SetState((int)state, (byte)(value ? 1 : 0), true, type);
    }

    // Bunker planner (string plan lines for easy JS parsing)
    // Returns lines like:
    //   MOVE table_area
    //   PICKUP_KEY
    //   MOVE storage_door
    //   UNLOCK_STORAGE
    //   MOVE c4_table
    //   PICKUP_C4
    //   MOVE bunker_door
    //   PLACE_C4
    //   MOVE safe_spot
    //   DETONATE
    //   MOVE star_pos
    //   PICKUP_STAR
    [JSExport]
    public static string PlanBunker()
    {
        throw new InvalidOperationException("PlanBunkerGoal is not implemented for direct calls. Use a specific goalKey or another planning entrypoint.");

        var ctx = new BunkerContext();
        var planner = new Planner<BunkerContext>();
        ctx.Init();

        static TaskStatus MoveToNode(BunkerContext c, string target)
        {
            var path = BunkerWorld.FindPath(BunkerWorld.FromContext(c), c.AgentAt, target);
            if (path == null) return TaskStatus.Failure;
            for (var i = 1; i < path.Count; i++)
            {
                c.Steps.Add($"MOVE {path[i]}");
                c.AgentAt = path[i];
            }
            return TaskStatus.Success;
        }

        var domain = new DomainBuilder<BunkerContext>("BunkerDomain")
            .Sequence("Mission")
            // Acquire key
                .Sequence("Acquire Key")
                .Condition("Missing key", c => !c.HasKey)
                .Action("Move to table")
                    .Do(c => MoveToNode(c, BunkerWorld.Nodes.TableArea))
                    .Effect("Arrive table", EffectType.PlanAndExecute, (c, _) => c.AgentAt = BunkerWorld.Nodes.TableArea)
                .End()
                .Action("Pickup key")
                    .Condition("At table and key present", c => c.AgentAt == BunkerWorld.Nodes.TableArea && c.KeyOnTable)
                    .Do(c => { c.Steps.Add("PICKUP_KEY"); return TaskStatus.Success; })
                    .Effect("Set hasKey", EffectType.PlanAndExecute, (c, _) => { c.HasKey = true; c.KeyOnTable = false; })
                .End()
                .End()

            // Acquire C4
                .Sequence("Acquire C4")
                .Condition("Missing C4", c => !c.HasC4)
                .Action("Move to storage door")
                    .Do(c => MoveToNode(c, BunkerWorld.Nodes.StorageDoor))
                    .Effect("Arrive storage door", EffectType.PlanAndExecute, (c, _) => c.AgentAt = BunkerWorld.Nodes.StorageDoor)
                .End()
                .Action("Unlock storage")
                    .Condition("Has key and locked", c => c.HasKey && !c.StorageUnlocked && c.AgentAt == BunkerWorld.Nodes.StorageDoor)
                    .Do(c => { c.Steps.Add("UNLOCK_STORAGE"); return TaskStatus.Success; })
                    .Effect("Unlock", EffectType.PlanAndExecute, (c, _) => c.StorageUnlocked = true)
                .End()
                .Action("Move to C4 table")
                    .Condition("Storage unlocked", c => c.StorageUnlocked)
                    .Do(c => MoveToNode(c, BunkerWorld.Nodes.C4Table))
                    .Effect("Arrive C4 table", EffectType.PlanAndExecute, (c, _) => c.AgentAt = BunkerWorld.Nodes.C4Table)
                .End()
                .Action("Pickup C4")
                    .Condition("At C4 table and available", c => c.AgentAt == BunkerWorld.Nodes.C4Table && c.C4Available && !c.HasC4)
                    .Do(c => { c.Steps.Add("PICKUP_C4"); return TaskStatus.Success; })
                    .Effect("Has C4", EffectType.PlanAndExecute, (c, _) => { c.HasC4 = true; c.C4Available = false; })
                .End()
                .End()

            // Breach bunker
                .Sequence("Breach bunker")
                .Condition("Bunker not breached", c => !c.BunkerBreached)
                .Select("Ensure C4 placed")
                    .Sequence("Place if needed")
                        .Condition("C4 not placed", c => !c.C4Placed)
                        .Action("Move to bunker door")
                            .Do(c => MoveToNode(c, BunkerWorld.Nodes.BunkerDoor))
                            .Effect("Arrive bunker door", EffectType.PlanAndExecute, (c, _) => c.AgentAt = BunkerWorld.Nodes.BunkerDoor)
                        .End()
                        .Action("Place C4")
                            .Condition("Has C4 at door", c => c.HasC4 && c.AgentAt == BunkerWorld.Nodes.BunkerDoor)
                            .Do(c => { c.Steps.Add("PLACE_C4"); return TaskStatus.Success; })
                            .Effect("C4 placed", EffectType.PlanAndExecute, (c, _) => { c.HasC4 = false; c.C4Placed = true; })
                        .End()
                    .End()
                    .Action("Already placed")
                        .Condition("C4 already placed", c => c.C4Placed)
                        .Do(_ => TaskStatus.Success)
                    .End()
                .End()
                .Action("Move to safe spot")
                    .Do(c => MoveToNode(c, BunkerWorld.Nodes.SafeSpot))
                    .Effect("Arrive safe", EffectType.PlanAndExecute, (c, _) => c.AgentAt = BunkerWorld.Nodes.SafeSpot)
                .End()
                .Action("Detonate")
                    .Condition("C4 placed and safe", c => c.C4Placed && c.AgentAt == BunkerWorld.Nodes.SafeSpot)
                    .Do(c => { c.Steps.Add("DETONATE"); return TaskStatus.Success; })
                    .Effect("Bunker breached", EffectType.PlanAndExecute, (c, _) => { c.BunkerBreached = true; c.C4Placed = false; })
                .End()
                .End()

            // Get star
                .Sequence("Get star")
                .Condition("Star not acquired", c => !c.HasStar && c.StarPresent)
                .Action("Move to bunker interior")
                    .Do(c => MoveToNode(c, BunkerWorld.Nodes.BunkerInterior))
                    .Effect("Arrive interior", EffectType.PlanAndExecute, (c, _) => c.AgentAt = BunkerWorld.Nodes.BunkerInterior)
                .End()
                .Action("Move to star")
                    .Do(c => MoveToNode(c, BunkerWorld.Nodes.StarPos))
                    .Effect("Arrive star", EffectType.PlanAndExecute, (c, _) => c.AgentAt = BunkerWorld.Nodes.StarPos)
                .End()
                .Action("Pickup star")
                    .Condition("At star", c => c.AgentAt == BunkerWorld.Nodes.StarPos)
                    .Do(c => { c.Steps.Add("PICKUP_STAR"); return TaskStatus.Success; })
                    .Effect("Has star", EffectType.PlanAndExecute, (c, _) => { c.HasStar = true; c.StarPresent = false; })
                .End()
                .End()

            // End
                .Select("Done")
                .Action("Done")
                    .Condition("Mission complete", c => c.HasStar)
                    .Do(c => { c.Done = true; return TaskStatus.Continue; })
                .End()
                .End()
            .End()
            .Build();

        {
            var guard = 0;
            const int MAX_TICKS = 10000;
            while (!ctx.Done && guard++ < MAX_TICKS)
            {
                planner.Tick(domain, ctx);
            }
            if (!ctx.Done)
            {
                ctx.Steps.Add("TIMEOUT");
                ctx.Done = true;
            }
        }

        return string.Join("\n", ctx.Steps);
    }

    public sealed class BunkerPlanRequest
    {
        public BunkerInitial? initial { get; set; }
        public BunkerGoal? goal { get; set; }
    }
    public sealed class BunkerInitial
    {
        public string? agentAt { get; set; }
        public bool? keyOnTable { get; set; }
        public bool? c4Available { get; set; }
        public bool? starPresent { get; set; }
        public bool? hasKey { get; set; }
        public bool? hasC4 { get; set; }
        public bool? hasStar { get; set; }
        public bool? storageUnlocked { get; set; }
        public bool? c4Placed { get; set; }
        public bool? bunkerBreached { get; set; }
    }
    public sealed class BunkerGoal
    {
        public string? agentAt { get; set; }
        public bool? hasKey { get; set; }
        public bool? hasC4 { get; set; }
        public bool? bunkerBreached { get; set; }
        public bool? hasStar { get; set; }
    }

    // Final state of the world returned by the planner
    public sealed class BunkerState
    {
        public string agentAt { get; set; } = BunkerWorld.Nodes.Courtyard;
        public bool keyOnTable { get; set; }
        public bool c4Available { get; set; }
        public bool starPresent { get; set; }
        public bool hasKey { get; set; }
        public bool hasC4 { get; set; }
        public bool hasStar { get; set; }
        public bool storageUnlocked { get; set; }
        public bool c4Placed { get; set; }
        public bool bunkerBreached { get; set; }
    }

    // JSON result envelope for planning responses
    public sealed class PlanResultJson
    {
        public string? error { get; set; }
        public bool done { get; set; }
        public List<string>? plan { get; set; }
        public List<string> logs { get; set; } = new List<string>();
        public BunkerState finalState { get; set; } = new BunkerState();
    }

    [JSExport]
    public static string PlanBunkerRequest(string requestJson)
    {
        var ctx = new BunkerContext();
        var planner = new Planner<BunkerContext>();

        // Initialize context first, then apply overrides to avoid Init() resetting them
        ctx.Init();

        // Parse JSON manually to avoid reflection-based serialization
        using (var doc = JsonDocument.Parse(requestJson))
        {
            var root = doc.RootElement;
            if (root.TryGetProperty("initial", out var initial))
            {
                if (initial.TryGetProperty("agentAt", out var v) && v.ValueKind == JsonValueKind.String) ctx.AgentAt = v.GetString()!;
                if (initial.TryGetProperty("keyOnTable", out v) && (v.ValueKind == JsonValueKind.True || v.ValueKind == JsonValueKind.False)) ctx.KeyOnTable = v.GetBoolean();
                if (initial.TryGetProperty("c4Available", out v) && (v.ValueKind == JsonValueKind.True || v.ValueKind == JsonValueKind.False)) ctx.C4Available = v.GetBoolean();
                if (initial.TryGetProperty("starPresent", out v) && (v.ValueKind == JsonValueKind.True || v.ValueKind == JsonValueKind.False)) ctx.StarPresent = v.GetBoolean();
                if (initial.TryGetProperty("hasKey", out v) && (v.ValueKind == JsonValueKind.True || v.ValueKind == JsonValueKind.False)) ctx.HasKey = v.GetBoolean();
                if (initial.TryGetProperty("hasC4", out v) && (v.ValueKind == JsonValueKind.True || v.ValueKind == JsonValueKind.False)) ctx.HasC4 = v.GetBoolean();
                if (initial.TryGetProperty("hasStar", out v) && (v.ValueKind == JsonValueKind.True || v.ValueKind == JsonValueKind.False)) ctx.HasStar = v.GetBoolean();
                if (initial.TryGetProperty("storageUnlocked", out v) && (v.ValueKind == JsonValueKind.True || v.ValueKind == JsonValueKind.False)) ctx.StorageUnlocked = v.GetBoolean();
                if (initial.TryGetProperty("c4Placed", out v) && (v.ValueKind == JsonValueKind.True || v.ValueKind == JsonValueKind.False)) ctx.C4Placed = v.GetBoolean();
                if (initial.TryGetProperty("bunkerBreached", out v) && (v.ValueKind == JsonValueKind.True || v.ValueKind == JsonValueKind.False)) ctx.BunkerBreached = v.GetBoolean();
            }
            if (root.TryGetProperty("goal", out var goal))
            {
                if (goal.TryGetProperty("agentAt", out var v2) && v2.ValueKind == JsonValueKind.String) ctx.GoalAgentAt = v2.GetString();
                if (goal.TryGetProperty("hasKey", out v2) && (v2.ValueKind == JsonValueKind.True || v2.ValueKind == JsonValueKind.False)) ctx.GoalHasKey = v2.GetBoolean();
                if (goal.TryGetProperty("hasC4", out v2) && (v2.ValueKind == JsonValueKind.True || v2.ValueKind == JsonValueKind.False)) ctx.GoalHasC4 = v2.GetBoolean();
                if (goal.TryGetProperty("bunkerBreached", out v2) && (v2.ValueKind == JsonValueKind.True || v2.ValueKind == JsonValueKind.False)) ctx.GoalBunkerBreached = v2.GetBoolean();
                if (goal.TryGetProperty("hasStar", out v2) && (v2.ValueKind == JsonValueKind.True || v2.ValueKind == JsonValueKind.False)) ctx.GoalHasStar = v2.GetBoolean();
            }
        }

        static TaskStatus MoveToNode(BunkerContext c, string target)
        {
            var path = BunkerWorld.FindPath(BunkerWorld.FromContext(c), c.AgentAt, target);
            if (path == null) return TaskStatus.Failure;
            for (var i = 1; i < path.Count; i++)
            {
                c.Steps.Add($"MOVE {path[i]}");
                c.AgentAt = path[i];
            }
            return TaskStatus.Success;
        }

        // Procedural fast-paths similar to PlanBunkerGoal for early success
        bool MoveTo(string target)
        {
            var world = BunkerWorld.FromContext(ctx);
            var path = BunkerWorld.FindPath(world, ctx.AgentAt, target);
            if (path == null) return false;
            for (var i = 1; i < path.Count; i++)
            {
                ctx.Steps.Add($"MOVE {path[i]}");
                ctx.AgentAt = path[i];
            }
            return true;
        }

        void EnsureKey()
        {
            if (ctx.HasKey) return;
            if (MoveTo(BunkerWorld.Nodes.TableArea))
            {
                if (ctx.AgentAt == BunkerWorld.Nodes.TableArea && ctx.KeyOnTable)
                {
                    ctx.Steps.Add("PICKUP_KEY");
                    ctx.HasKey = true;
                    ctx.KeyOnTable = false;
                }
            }
        }

        void EnsureHasC4()
        {
            if (ctx.HasC4) return;
            EnsureKey();
            if (MoveTo(BunkerWorld.Nodes.StorageDoor))
            {
                if (!ctx.StorageUnlocked && ctx.HasKey && ctx.AgentAt == BunkerWorld.Nodes.StorageDoor)
                {
                    ctx.Steps.Add("UNLOCK_STORAGE");
                    ctx.StorageUnlocked = true;
                }
            }
            if (MoveTo(BunkerWorld.Nodes.C4Table))
            {
                if (ctx.AgentAt == BunkerWorld.Nodes.C4Table && ctx.C4Available && !ctx.HasC4)
                {
                    ctx.Steps.Add("PICKUP_C4");
                    ctx.HasC4 = true;
                    ctx.C4Available = false;
                }
            }
        }

        void EnsureBreach()
        {
            if (ctx.BunkerBreached) return;
            EnsureHasC4();
            if (MoveTo(BunkerWorld.Nodes.BunkerDoor))
            {
                if (ctx.HasC4 && ctx.AgentAt == BunkerWorld.Nodes.BunkerDoor && !ctx.C4Placed)
                {
                    ctx.Steps.Add("PLACE_C4");
                    ctx.HasC4 = false;
                    ctx.C4Placed = true;
                }
            }
            if (MoveTo(BunkerWorld.Nodes.SafeSpot))
            {
                if (ctx.C4Placed && !ctx.BunkerBreached && ctx.AgentAt == BunkerWorld.Nodes.SafeSpot)
                {
                    ctx.Steps.Add("DETONATE");
                    ctx.BunkerBreached = true;
                    ctx.C4Placed = false;
                }
            }
        }

        // Helper to serialize the result to JSON
        string BuildResult(string? error = null, bool timedOut = false)
        {
            var planLines = new List<string>();
            var logLines = new List<string>();
            foreach (var s in ctx.Steps)
            {
                if (string.IsNullOrWhiteSpace(s)) continue;
                if (s.StartsWith("# "))
                {
                    logLines.Add(s.Substring(2));
                }
                else
                {
                    planLines.Add(s);
                }
            }
            var done = timedOut ? false : (ctx.Done || IsGoalMet(ctx));
            var state = new BunkerState
            {
                agentAt = ctx.AgentAt,
                keyOnTable = ctx.KeyOnTable,
                c4Available = ctx.C4Available,
                starPresent = ctx.StarPresent,
                hasKey = ctx.HasKey,
                hasC4 = ctx.HasC4,
                hasStar = ctx.HasStar,
                storageUnlocked = ctx.StorageUnlocked,
                c4Placed = ctx.C4Placed,
                bunkerBreached = ctx.BunkerBreached,
            };

            using var stream = new MemoryStream();
            using (var writer = new Utf8JsonWriter(stream))
            {
                writer.WriteStartObject();
                if (error != null) writer.WriteString("error", error);
                writer.WriteBoolean("done", done);
                if (planLines.Count > 0)
                {
                    writer.WritePropertyName("plan");
                    writer.WriteStartArray();
                    foreach (var p in planLines) writer.WriteStringValue(p);
                    writer.WriteEndArray();
                }
                writer.WritePropertyName("logs");
                writer.WriteStartArray();
                foreach (var l in logLines) writer.WriteStringValue(l);
                writer.WriteEndArray();
                writer.WritePropertyName("finalState");
                writer.WriteStartObject();
                writer.WriteString("agentAt", state.agentAt);
                writer.WriteBoolean("keyOnTable", state.keyOnTable);
                writer.WriteBoolean("c4Available", state.c4Available);
                writer.WriteBoolean("starPresent", state.starPresent);
                writer.WriteBoolean("hasKey", state.hasKey);
                writer.WriteBoolean("hasC4", state.hasC4);
                writer.WriteBoolean("hasStar", state.hasStar);
                writer.WriteBoolean("storageUnlocked", state.storageUnlocked);
                writer.WriteBoolean("c4Placed", state.c4Placed);
                writer.WriteBoolean("bunkerBreached", state.bunkerBreached);
                writer.WriteEndObject();
                writer.WriteEndObject();
                writer.Flush();
            }
            return Encoding.UTF8.GetString(stream.ToArray());
        }

        // Execute procedural path when possible
        if (ctx.GoalAgentAt != null && ctx.GoalHasKey != true && ctx.GoalHasC4 != true && ctx.GoalBunkerBreached != true && ctx.GoalHasStar != true)
        {
            var ok = MoveTo(ctx.GoalAgentAt);
            return BuildResult(ok ? null : "PATH_NOT_FOUND");
        }
        if (ctx.GoalHasKey == true)
        {
            EnsureKey();
            return BuildResult();
        }
        if (ctx.GoalHasC4 == true)
        {
            EnsureHasC4();
            return BuildResult();
        }
        if (ctx.GoalBunkerBreached == true)
        {
            EnsureBreach();
            return BuildResult();
        }
        if (ctx.GoalHasStar == true)
        {
            EnsureBreach();
            MoveTo(BunkerWorld.Nodes.BunkerInterior);
            MoveTo(BunkerWorld.Nodes.StarPos);
            if (ctx.AgentAt == BunkerWorld.Nodes.StarPos && !ctx.HasStar && ctx.StarPresent)
            {
                ctx.Steps.Add("PICKUP_STAR");
                ctx.HasStar = true;
                ctx.StarPresent = false;
            }
            if (ctx.GoalAgentAt != null)
            {
                MoveTo(ctx.GoalAgentAt);
            }
            return BuildResult();
        }

        var domain = new DomainBuilder<BunkerContext>("BunkerDomainDynamic")
            .Sequence("MissionGoal")
            .Select("GoalSwitch")
                .Action("Already at goal")
                    .Condition("At goal", c => c.GoalAgentAt != null && c.AgentAt == c.GoalAgentAt)
                    .Do(_ => TaskStatus.Success)
                .End()
                // agentAt goal: just move
                .Sequence("Move to target node")
                    .Condition("Goal agentAt", c => c.GoalAgentAt != null)
                    .Condition("Not already there", c => c.AgentAt != c.GoalAgentAt)
                    .Action("Move to goal")
                        .Do(c => MoveToNode(c, c.GoalAgentAt!))
                        .Effect("Arrive goal", EffectType.PlanAndExecute, (c, _) => c.AgentAt = c.GoalAgentAt!)
                    .End()
                .End()

                // hasKey goal
                .Sequence("Ensure hasKey")
                    .Condition("Goal hasKey", c => c.GoalHasKey == true)
                    .Action("Move to table")
                        .Condition("Missing key", c => !c.HasKey)
                        .Do(c => MoveToNode(c, BunkerWorld.Nodes.TableArea))
                        .Effect("Arrive table", EffectType.PlanAndExecute, (c, _) => c.AgentAt = BunkerWorld.Nodes.TableArea)
                    .End()
                    .Action("Pickup key")
                        .Condition("At table and present", c => c.AgentAt == BunkerWorld.Nodes.TableArea && c.KeyOnTable && !c.HasKey)
                        .Do(c => { c.Steps.Add("PICKUP_KEY"); return TaskStatus.Success; })
                        .Effect("HasKey", EffectType.PlanAndExecute, (c, _) => { c.HasKey = true; c.KeyOnTable = false; })
                    .End()
                .End()

                // hasC4 goal
                .Sequence("Ensure hasC4")
                    .Condition("Goal hasC4", c => c.GoalHasC4 == true)
                    // acquire key if missing
                    .Action("Move to table")
                        .Condition("Missing key", c => !c.HasKey)
                        .Do(c => MoveToNode(c, BunkerWorld.Nodes.TableArea))
                    .End()
                    .Action("Pickup key")
                        .Condition("Need key", c => !c.HasKey && c.AgentAt == BunkerWorld.Nodes.TableArea && c.KeyOnTable)
                        .Do(c => { c.Steps.Add("PICKUP_KEY"); return TaskStatus.Success; })
                        .Effect("HasKey", EffectType.PlanAndExecute, (c, _) => { c.HasKey = true; c.KeyOnTable = false; })
                    .End()
                    // unlock and get C4
                    .Action("Move to storage door")
                        .Do(c => MoveToNode(c, BunkerWorld.Nodes.StorageDoor))
                        .Effect("Arrive storage door", EffectType.PlanAndExecute, (c, _) => c.AgentAt = BunkerWorld.Nodes.StorageDoor)
                    .End()
                    .Action("Unlock storage")
                        .Condition("Locked and has key", c => !c.StorageUnlocked && c.HasKey && c.AgentAt == BunkerWorld.Nodes.StorageDoor)
                        .Do(c => { c.Steps.Add("UNLOCK_STORAGE"); return TaskStatus.Success; })
                        .Effect("Unlocked", EffectType.PlanAndExecute, (c, _) => c.StorageUnlocked = true)
                    .End()
                    .Action("Move to C4 table")
                        .Do(c => MoveToNode(c, BunkerWorld.Nodes.C4Table))
                        .Effect("Arrive C4 table", EffectType.PlanAndExecute, (c, _) => c.AgentAt = BunkerWorld.Nodes.C4Table)
                    .End()
                    .Action("Pickup C4")
                        .Condition("At C4 and available", c => !c.HasC4 && c.AgentAt == BunkerWorld.Nodes.C4Table && c.C4Available)
                        .Do(c => { c.Steps.Add("PICKUP_C4"); return TaskStatus.Success; })
                        .Effect("HasC4", EffectType.PlanAndExecute, (c, _) => { c.HasC4 = true; c.C4Available = false; })
                    .End()
                .End()

                // bunkerBreached goal
                .Sequence("Ensure breach")
                    .Condition("Goal breach", c => c.GoalBunkerBreached == true)
                    // ensure C4
                    .Action("Move to table")
                        .Condition("Missing key", c => !c.HasKey)
                        .Do(c => MoveToNode(c, BunkerWorld.Nodes.TableArea))
                        .Effect("Arrive table", EffectType.PlanAndExecute, (c, _) => c.AgentAt = BunkerWorld.Nodes.TableArea)
                    .End()
                    .Action("Pickup key")
                        .Condition("Need key", c => !c.HasKey && c.AgentAt == BunkerWorld.Nodes.TableArea && c.KeyOnTable)
                        .Do(c => { c.Steps.Add("PICKUP_KEY"); return TaskStatus.Success; })
                        .Effect("HasKey", EffectType.PlanAndExecute, (c, _) => { c.HasKey = true; c.KeyOnTable = false; })
                    .End()
                    .Action("Move to storage door")
                        .Condition("Need C4", c => !c.HasC4)
                        .Do(c => MoveToNode(c, BunkerWorld.Nodes.StorageDoor))
                        .Effect("Arrive storage door", EffectType.PlanAndExecute, (c, _) => c.AgentAt = BunkerWorld.Nodes.StorageDoor)
                    .End()
                    .Action("Unlock storage")
                        .Condition("Need unlock", c => !c.HasC4 && !c.StorageUnlocked && c.HasKey && c.AgentAt == BunkerWorld.Nodes.StorageDoor)
                        .Do(c => { c.Steps.Add("UNLOCK_STORAGE"); return TaskStatus.Success; })
                        .Effect("Unlocked", EffectType.PlanAndExecute, (c, _) => c.StorageUnlocked = true)
                    .End()
                    .Action("Move to C4 table")
                        .Condition("Need C4 move", c => !c.HasC4)
                        .Do(c => MoveToNode(c, BunkerWorld.Nodes.C4Table))
                        .Effect("Arrive C4 table", EffectType.PlanAndExecute, (c, _) => c.AgentAt = BunkerWorld.Nodes.C4Table)
                    .End()
                    .Action("Pickup C4")
                        .Condition("Pickup C4 cond", c => !c.HasC4 && c.AgentAt == BunkerWorld.Nodes.C4Table && c.C4Available)
                        .Do(c => { c.Steps.Add("PICKUP_C4"); return TaskStatus.Success; })
                        .Effect("HasC4", EffectType.PlanAndExecute, (c, _) => { c.HasC4 = true; c.C4Available = false; })
                    .End()
                    .Action("Move to bunker door")
                        .Do(c => MoveToNode(c, BunkerWorld.Nodes.BunkerDoor))
                        .Effect("Arrive bunker door", EffectType.PlanAndExecute, (c, _) => c.AgentAt = BunkerWorld.Nodes.BunkerDoor)
                    .End()
                    .Action("Place C4")
                        .Condition("Place C4 cond", c => c.HasC4 && c.AgentAt == BunkerWorld.Nodes.BunkerDoor && !c.C4Placed)
                        .Do(c => { c.Steps.Add("PLACE_C4"); return TaskStatus.Success; })
                        .Effect("Placed", EffectType.PlanAndExecute, (c, _) => { c.HasC4 = false; c.C4Placed = true; })
                    .End()
                    .Action("Move to safe")
                        .Do(c => MoveToNode(c, BunkerWorld.Nodes.SafeSpot))
                        .Effect("Arrive safe", EffectType.PlanAndExecute, (c, _) => c.AgentAt = BunkerWorld.Nodes.SafeSpot)
                    .End()
                    .Action("Detonate")
                        .Condition("Detonate cond", c => c.C4Placed && !c.BunkerBreached && c.AgentAt == BunkerWorld.Nodes.SafeSpot)
                        .Do(c => { c.Steps.Add("DETONATE"); return TaskStatus.Success; })
                        .Effect("Breached", EffectType.PlanAndExecute, (c, _) => { c.BunkerBreached = true; c.C4Placed = false; })
                    .End()
                .End()

                // hasStar goal
                .Sequence("Ensure star")
                    .Condition("Goal star", c => c.GoalHasStar == true)
                    // Reuse breach sequence subset
                    .Action("Move to table")
                        .Condition("Missing key", c => !c.HasKey)
                        .Do(c => MoveToNode(c, BunkerWorld.Nodes.TableArea))
                        .Effect("Arrive table", EffectType.PlanAndExecute, (c, _) => c.AgentAt = BunkerWorld.Nodes.TableArea)
                    .End()
                    .Action("Pickup key")
                        .Condition("Need key", c => !c.HasKey && c.AgentAt == BunkerWorld.Nodes.TableArea && c.KeyOnTable)
                        .Do(c => { c.Steps.Add("PICKUP_KEY"); return TaskStatus.Success; })
                        .Effect("HasKey", EffectType.PlanAndExecute, (c, _) => { c.HasKey = true; c.KeyOnTable = false; })
                    .End()
                    .Action("Move to storage door")
                        .Condition("Need C4", c => !c.HasC4)
                        .Do(c => MoveToNode(c, BunkerWorld.Nodes.StorageDoor))
                        .Effect("Arrive storage door", EffectType.PlanAndExecute, (c, _) => c.AgentAt = BunkerWorld.Nodes.StorageDoor)
                    .End()
                    .Action("Unlock storage")
                        .Condition("Need unlock", c => !c.HasC4 && !c.StorageUnlocked && c.HasKey && c.AgentAt == BunkerWorld.Nodes.StorageDoor)
                        .Do(c => { c.Steps.Add("UNLOCK_STORAGE"); return TaskStatus.Success; })
                        .Effect("Unlocked", EffectType.PlanAndExecute, (c, _) => c.StorageUnlocked = true)
                    .End()
                    .Action("Move to C4 table")
                        .Condition("Need C4 move", c => !c.HasC4)
                        .Do(c => MoveToNode(c, BunkerWorld.Nodes.C4Table))
                        .Effect("Arrive C4 table", EffectType.PlanAndExecute, (c, _) => c.AgentAt = BunkerWorld.Nodes.C4Table)
                    .End()
                    .Action("Pickup C4")
                        .Condition("Pickup C4 cond", c => !c.HasC4 && c.AgentAt == BunkerWorld.Nodes.C4Table && c.C4Available)
                        .Do(c => { c.Steps.Add("PICKUP_C4"); return TaskStatus.Success; })
                        .Effect("HasC4", EffectType.PlanAndExecute, (c, _) => { c.HasC4 = true; c.C4Available = false; })
                    .End()
                    .Action("Move to bunker door")
                        .Do(c => MoveToNode(c, BunkerWorld.Nodes.BunkerDoor))
                        .Effect("Arrive bunker door", EffectType.PlanAndExecute, (c, _) => c.AgentAt = BunkerWorld.Nodes.BunkerDoor)
                    .End()
                    .Action("Place C4")
                        .Condition("Place C4 cond", c => c.HasC4 && c.AgentAt == BunkerWorld.Nodes.BunkerDoor && !c.C4Placed)
                        .Do(c => { c.Steps.Add("PLACE_C4"); return TaskStatus.Success; })
                        .Effect("Placed", EffectType.PlanAndExecute, (c, _) => { c.HasC4 = false; c.C4Placed = true; })
                    .End()
                    .Action("Move to safe")
                        .Do(c => MoveToNode(c, BunkerWorld.Nodes.SafeSpot))
                        .Effect("Arrive safe", EffectType.PlanAndExecute, (c, _) => c.AgentAt = BunkerWorld.Nodes.SafeSpot)
                    .End()
                    .Action("Detonate")
                        .Condition("Detonate cond", c => c.C4Placed && !c.BunkerBreached && c.AgentAt == BunkerWorld.Nodes.SafeSpot)
                        .Do(c => { c.Steps.Add("DETONATE"); return TaskStatus.Success; })
                        .Effect("Breached", EffectType.PlanAndExecute, (c, _) => { c.BunkerBreached = true; c.C4Placed = false; })
                    .End()
                    .Action("Move to bunker interior")
                        .Do(c => MoveToNode(c, BunkerWorld.Nodes.BunkerInterior))
                        .Effect("Arrive interior", EffectType.PlanAndExecute, (c, _) => c.AgentAt = BunkerWorld.Nodes.BunkerInterior)
                    .End()
                    .Action("Move to star")
                        .Do(c => MoveToNode(c, BunkerWorld.Nodes.StarPos))
                        .Effect("Arrive star", EffectType.PlanAndExecute, (c, _) => c.AgentAt = BunkerWorld.Nodes.StarPos)
                    .End()
                    .Action("Pickup star")
                        .Condition("At star", c => c.AgentAt == BunkerWorld.Nodes.StarPos && !c.HasStar && c.StarPresent)
                        .Do(c => { c.Steps.Add("PICKUP_STAR"); return TaskStatus.Success; })
                        .Effect("HasStar", EffectType.PlanAndExecute, (c, _) => { c.HasStar = true; c.StarPresent = false; })
                    .End()
                .End()
            .End()
            .Select("Done")
                .Action("Done")
                    .Condition("Goal met", IsGoalMet)
                    .Do(c => { c.Done = true; return TaskStatus.Continue; })
                .End()
            .End()
            .End()
            .Build();

        bool timedOut = false;
        {
            var guard = 0;
            const int MAX_TICKS = 100000;
            while (!ctx.Done && guard++ < MAX_TICKS)
            {
                planner.Tick(domain, ctx);
            }
            if (!ctx.Done)
            {
                timedOut = true;
            }
        }

        // Return structured JSON result
        return BuildResult(timedOut ? "Timeout" : null, timedOut);
    }


    public sealed class BunkerContext : BaseContext
    {
        public override List<string>? MTRDebug { get; set; }
        public override List<string>? LastMTRDebug { get; set; }
        public override bool DebugMTR { get; } = false;
        public override Queue<IBaseDecompositionLogEntry>? DecompositionLog { get; set; }
        public override bool LogDecomposition { get; } = false;

        public override IFactory Factory { get; protected set; } = new DefaultFactory();
        public override IPlannerState PlannerState { get; protected set; } = new DefaultPlannerState();

        private readonly byte[] _world = new byte[1];
        public override byte[] WorldState => _world;

        public List<string> Steps { get; } = new List<string>();

        // World facts / inventory
        public string AgentAt { get; set; } = BunkerWorld.Nodes.Courtyard;
        public bool KeyOnTable { get; set; } = true;
        public bool C4Available { get; set; } = true;
        public bool StarPresent { get; set; } = true;
        public bool HasKey { get; set; } = false;
        public bool HasC4 { get; set; } = false;
        public bool HasStar { get; set; } = false;
        public bool StorageUnlocked { get; set; } = false;
        public bool C4Placed { get; set; } = false;
        public bool BunkerBreached { get; set; } = false;

        public bool Done { get; set; } = false;

        // Goal fields (optional)
        public string? GoalAgentAt { get; set; }
        public bool? GoalHasKey { get; set; }
        public bool? GoalHasC4 { get; set; }
        public bool? GoalBunkerBreached { get; set; }
        public bool? GoalHasStar { get; set; }
    }

    private static bool IsGoalMet(BunkerContext c)
    {
        if (c.GoalAgentAt != null) return c.AgentAt == c.GoalAgentAt;
        if (c.GoalHasStar == true) return c.HasStar;
        if (c.GoalBunkerBreached == true) return c.BunkerBreached;
        if (c.GoalHasC4 == true) return c.HasC4;
        if (c.GoalHasKey == true) return c.HasKey;
        // Default to star mission if no goal given
        return c.HasStar;
    }

    private sealed class BunkerWorld
    {
        public static class Nodes
        {
            public const string Courtyard = "courtyard";
            public const string TableArea = "table_area";
            public const string StorageDoor = "storage_door";
            public const string StorageInterior = "storage_interior";
            public const string C4Table = "c4_table";
            public const string BunkerDoor = "bunker_door";
            public const string BunkerInterior = "bunker_interior";
            public const string StarPos = "star_pos";
            public const string SafeSpot = "safe_spot";
        }

        // World facts / inventory
        public string AgentAt { get; set; } = Nodes.Courtyard;
        public bool KeyOnTable { get; set; } = true;
        public bool C4Available { get; set; } = true;
        public bool StarPresent { get; set; } = true;
        public bool HasKey { get; set; } = false;
        public bool HasC4 { get; set; } = false;
        public bool HasStar { get; set; } = false;
        public bool StorageUnlocked { get; set; } = false;
        public bool C4Placed { get; set; } = false;
        public bool BunkerBreached { get; set; } = false;

        private static readonly (string a, string b, Func<BunkerWorld, bool> allowed)[] RawEdges = new[]
        {
            (Nodes.Courtyard, Nodes.TableArea,      (Func<BunkerWorld, bool>)(_ => true)),
            (Nodes.Courtyard, Nodes.StorageDoor,    _ => true),
            (Nodes.Courtyard, Nodes.BunkerDoor,     _ => true),
            (Nodes.Courtyard, Nodes.SafeSpot,       _ => true),
            // Sync with TS world: direct table <-> storage door link
            (Nodes.TableArea, Nodes.StorageDoor,    _ => true),
            (Nodes.StorageDoor, Nodes.StorageInterior, w => w.StorageUnlocked),
            (Nodes.StorageInterior, Nodes.C4Table,  _ => true),
            // Sync with TS world: allow direct storage door <-> bunker door link
            (Nodes.StorageDoor, Nodes.BunkerDoor,   _ => true),
            (Nodes.BunkerDoor, Nodes.BunkerInterior, w => w.BunkerBreached),
            (Nodes.BunkerDoor, Nodes.SafeSpot,      _ => true),
            (Nodes.BunkerInterior, Nodes.StarPos,   _ => true),
        };

        public static BunkerWorld FromContext(BunkerContext c)
        {
            return new BunkerWorld
            {
                AgentAt = c.AgentAt,
                KeyOnTable = c.KeyOnTable,
                C4Available = c.C4Available,
                StarPresent = c.StarPresent,
                HasKey = c.HasKey,
                HasC4 = c.HasC4,
                HasStar = c.HasStar,
                StorageUnlocked = c.StorageUnlocked,
                C4Placed = c.C4Placed,
                BunkerBreached = c.BunkerBreached,
            };
        }

        public static List<string>? FindPath(BunkerWorld w, string from, string to)
        {
            if (from == to) return new List<string> { from };
            var adj = BuildAdj(w);
            var q = new Queue<string>();
            var prev = new Dictionary<string, string?>();
            q.Enqueue(from);
            prev[from] = null;
            while (q.Count > 0)
            {
                var cur = q.Dequeue();
                if (!adj.TryGetValue(cur, out var nexts)) continue;
                foreach (var n in nexts)
                {
                    if (prev.ContainsKey(n)) continue;
                    prev[n] = cur;
                    if (n == to)
                    {
                        var path = new List<string>();
                        var p = to;
                        while (p != null)
                        {
                            path.Add(p);
                            p = prev[p!];
                        }
                        path.Reverse();
                        return path;
                    }
                    q.Enqueue(n);
                }
            }
            return null;
        }

        private static Dictionary<string, List<string>> BuildAdj(BunkerWorld w)
        {
            var map = new Dictionary<string, List<string>>();
            void Add(string a, string b)
            {
                if (!map.TryGetValue(a, out var list)) map[a] = list = new List<string>();
                list.Add(b);
            }
            foreach (var (a, b, allowed) in RawEdges)
            {
                if (allowed(w)) Add(a, b);
                if (allowed(w)) Add(b, a);
            }
            return map;
        }
    }
    
}