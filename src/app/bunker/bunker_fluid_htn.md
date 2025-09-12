Below is an attempt at a faithful port of your Mahler demo to **Fluid HTN (C#)**.
It preserves your world, path‑gating (locked door / breached bunker), task logic, and the overall “Acquire key → Acquire C4 → Breach → Get star” flow. I kept movement as a *single primitive* “MoveTo(target)” action that succeeds iff a path is currently traversable (your BFS with gates). This matches your Mahler behavior where the agent “teleports if a traversable path exists.”
I also included a small *domain builder* with readable helpers, mirroring your compound tasks.

> **Why this shape?** In Fluid HTN you typically describe behavior via a fluent *DomainBuilder*, with Conditions, Actions (Do), and Effects. World state is a small `byte[]` indexed by an enum, and planning happens by decomposing compound tasks into primitive actions. The library’s README shows this style; I’ve followed it closely so you can extend it easily. ([GitHub][1])

---

## How to run

### Option A — simplest (clone Fluid HTN locally and reference the project)

```bash
# 1) Get the Fluid HTN sources next to your project
git clone https://github.com/ptrefall/fluid-hierarchical-task-network.git

# 2) Create a new console app
dotnet new console -n BunkerStarHTN
cd BunkerStarHTN

# 3) Replace Program.cs with the code below (or add it as src files)

# 4) Add a project reference to the Fluid-HTN library
dotnet add reference ../fluid-hierarchical-task-network/Fluid-HTN/Fluid-HTN.csproj

# 5) Build & run
dotnet run
```

Fluid HTN is designed to be used from source and includes a builder DSL, conditions, operators and effects (see README). ([GitHub][1])

> **Note:** There isn’t an official NuGet for Fluid HTN at the time of writing; the recommended approach is to reference the library source directly or bring the project into your solution (this is how the official example repos use it). ([GitHub][2])

---

## Program.cs (drop-in)

> A single file you can paste into your console project. It defines:
>
> * world enums and state,
> * BFS path‑finding with gated edges,
> * a `BunkerContext` derived from `BaseContext`,
> * a tiny domain builder with helpers,
> * the complete domain mirroring your Mahler methods and primitives,
> * a main loop that ticks the planner until “Done”.

```csharp
using System;
using System.Collections.Generic;
using FluidHTN;
using FluidHTN.Compounds;
using FluidHTN.Contexts;
using FluidHTN.Factory;
using FluidHTN.PrimitiveTasks;

namespace BunkerStarHTN
{
    // -------------------------------
    // 2D world model (same nodes)
    // -------------------------------

    public enum Location : byte
    {
        Courtyard,
        TableArea,          // key is here
        StorageDoor,
        StorageInterior,
        C4Table,            // C4 is here
        BunkerDoor,
        BunkerInterior,
        StarPos,            // star is here (inside the bunker)
        SafeSpot,           // safe distance for detonation
    }

    // World state (Fluid HTN uses byte[] world state indexed by enum)  ──>
    public enum WS : byte
    {
        AgentAt,           // (byte) Location
        // World facts (informative; gated by effects anyway)
        KeyOnTable,        // bool
        C4Available,       // bool
        StarPresent,       // bool
        // Inventory
        HasKey,            // bool
        HasC4,             // bool
        HasStar,           // bool
        // Environment
        StorageUnlocked,   // bool
        C4Placed,          // bool
        BunkerBreached     // bool
    }

    // -------------------------------
    // Context (planner blackboard)
    // -------------------------------

    public sealed class BunkerContext : BaseContext
    {
        // Required overrides (see Fluid HTN README)
        public override List<string> MTRDebug { get; set; } = null;
        public override List<string> LastMTRDebug { get; set; } = null;
        public override bool DebugMTR { get; } = false;
        public override Queue<IBaseDecompositionLogEntry> DecompositionLog { get; set; } = null;
        public override bool LogDecomposition { get; } = false;

        public override IFactory Factory { get; protected set; } = new DefaultFactory();
        public override IPlannerState PlannerState { get; protected set; } = new DefaultPlannerState();

        private readonly byte[] _ws = new byte[Enum.GetValues(typeof(WS)).Length];
        public override byte[] WorldState => _ws;

        // A simple flag to let us exit the tick loop.
        public bool Done { get; set; }

        // Convenience accessors (bool)
        public bool Has(WS s) => HasState((int)s, 1);
        public bool Has(WS s, bool v) => HasState((int)s, (byte)(v ? 1 : 0));
        public void Set(WS s, bool v, EffectType type) => SetState((int)s, (byte)(v ? 1 : 0), true, type);

        // Location accessors
        public Location AgentAt
        {
            get => (Location)WorldState[(int)WS.AgentAt];
        }
        public void SetLocation(Location loc, EffectType type) =>
            SetState((int)WS.AgentAt, (byte)loc, true, type);

        // ---------------------------
        // Gated graph (same edges)
        // ---------------------------
        private struct Edge
        {
            public Location A, B;
            public Func<BunkerContext, bool> When;
            public Edge(Location a, Location b, Func<BunkerContext, bool> when) { A = a; B = b; When = when; }
        }

        private static readonly Edge[] RawEdges = new[]
        {
            new Edge(Location.Courtyard,    Location.TableArea,      c => true),
            new Edge(Location.Courtyard,    Location.StorageDoor,    c => true),
            new Edge(Location.Courtyard,    Location.BunkerDoor,     c => true),
            new Edge(Location.Courtyard,    Location.SafeSpot,       c => true),
            new Edge(Location.StorageDoor,  Location.StorageInterior,c => c.Has(WS.StorageUnlocked,true)),
            new Edge(Location.StorageInterior, Location.C4Table,     c => true),
            new Edge(Location.BunkerDoor,   Location.BunkerInterior, c => c.Has(WS.BunkerBreached,true)),
            new Edge(Location.BunkerDoor,   Location.SafeSpot,       c => true),
            new Edge(Location.BunkerInterior, Location.StarPos,      c => true),
        };

        private readonly Dictionary<Location, List<(Location to, Func<BunkerContext, bool> When)>> _adj;

        public BunkerContext()
        {
            _adj = new Dictionary<Location, List<(Location, Func<BunkerContext, bool>)>>();
            foreach (var e in RawEdges)
            {
                if (!_adj.TryGetValue(e.A, out var listA)) _adj[e.A] = listA = new List<(Location, Func<BunkerContext, bool>)>();
                if (!_adj.TryGetValue(e.B, out var listB)) _adj[e.B] = listB = new List<(Location, Func<BunkerContext, bool>)>();
                listA.Add((e.B, e.When));
                listB.Add((e.A, e.When));
            }
        }

        private IEnumerable<Location> Neighbors(Location from)
        {
            if (_adj.TryGetValue(from, out var list))
                foreach (var (to, when) in list)
                    if (when(this)) yield return to;
        }

        public bool IsImmediatelyReachable(Location from, Location to)
        {
            foreach (var n in Neighbors(from)) if (n == to) return true;
            return false;
        }

        public bool IsReachable(Location from, Location to)
        {
            if (from == to) return true;
            var seen = new HashSet<Location> { from };
            var q = new Queue<Location>();
            q.Enqueue(from);
            while (q.Count > 0)
            {
                var cur = q.Dequeue();
                foreach (var n in Neighbors(cur))
                {
                    if (!seen.Add(n)) continue;
                    if (n == to) return true;
                    q.Enqueue(n);
                }
            }
            return false;
        }

        public List<Location> FindPath(Location from, Location to)
        {
            if (from == to) return new List<Location> { from };
            var seen = new HashSet<Location> { from };
            var q = new Queue<Location>();
            var prev = new Dictionary<Location, Location>();
            q.Enqueue(from);

            while (q.Count > 0)
            {
                var cur = q.Dequeue();
                foreach (var n in Neighbors(cur))
                {
                    if (!seen.Add(n)) continue;
                    prev[n] = cur;
                    if (n.Equals(to))
                    {
                        var path = new List<Location> { to };
                        var p = to;
                        while (prev.TryGetValue(p, out var p2))
                        {
                            path.Add(p2);
                            p = p2;
                        }
                        path.Reverse();
                        return path;
                    }
                    q.Enqueue(n);
                }
            }
            return null;
        }

        public override void Init()
        {
            base.Init();
            Done = false;
        }
    }

    // ---------------------------------------
    // Domain Builder with tiny helpers
    // ---------------------------------------
    public sealed class BunkerDomainBuilder : BaseDomainBuilder<BunkerDomainBuilder, BunkerContext>
    {
        public BunkerDomainBuilder(string name) : base(name, new DefaultFactory()) { }

        // A generic No-Op action (useful in selectors)
        public BunkerDomainBuilder Succeed(string name = "NoOp")
        {
            Action(name)
                .Do(_ => TaskStatus.Success)
            .End();
            return this;
        }

        // Movement primitive: teleport if a traversable path exists right now.
        public BunkerDomainBuilder MoveTo(Location dest)
        {
            Action($"Move to {dest}")
                .Condition("Not already there", c => c.AgentAt != dest)
                .Condition("Path exists (with gates)", c => c.IsReachable(c.AgentAt, dest))
                .Do(ctx =>
                {
                    // For the demo we just log, but this could be a real mover operator.
                    var path = ctx.FindPath(ctx.AgentAt, dest);
                    Console.WriteLine(path != null
                        ? $"MoveTo: {string.Join(" -> ", path)}"
                        : $"MoveTo: (no path) to {dest}");
                    return TaskStatus.Success;
                })
                .Effect("agentAt := dest", EffectType.PlanAndExecute, (c, t) => c.SetLocation(dest, t))
            .End();
            return this;
        }

        public BunkerDomainBuilder PickUpKey()
        {
            Action("Pick up key")
                .Condition("!hasKey", c => !c.Has(WS.HasKey))
                .Condition("at table", c => c.AgentAt == Location.TableArea)
                .Do(_ =>
                {
                    Console.WriteLine("PickUpKey");
                    return TaskStatus.Success;
                })
                .Effect("hasKey := true", EffectType.PlanAndExecute, (c, t) => c.Set(WS.HasKey, true, t))
                .Effect("keyOnTable := false", EffectType.PlanAndExecute, (c, t) => c.Set(WS.KeyOnTable, false, t))
            .End();
            return this;
        }

        public BunkerDomainBuilder UnlockStorage()
        {
            Action("Unlock storage door with key")
                .Condition("hasKey", c => c.Has(WS.HasKey))
                .Condition("!unlocked", c => !c.Has(WS.StorageUnlocked))
                .Condition("at storageDoor", c => c.AgentAt == Location.StorageDoor)
                .Do(_ =>
                {
                    Console.WriteLine("UnlockStorage");
                    return TaskStatus.Success;
                })
                .Effect("storageUnlocked := true", EffectType.PlanAndExecute, (c, t) => c.Set(WS.StorageUnlocked, true, t))
            .End();
            return this;
        }

        public BunkerDomainBuilder PickUpC4()
        {
            Action("Pick up C4")
                .Condition("!hasC4", c => !c.Has(WS.HasC4))
                .Condition("at c4 table", c => c.AgentAt == Location.C4Table)
                .Do(_ =>
                {
                    Console.WriteLine("PickUpC4");
                    return TaskStatus.Success;
                })
                .Effect("hasC4 := true", EffectType.PlanAndExecute, (c, t) => c.Set(WS.HasC4, true, t))
                .Effect("c4Available := false", EffectType.PlanAndExecute, (c, t) => c.Set(WS.C4Available, false, t))
            .End();
            return this;
        }

        public BunkerDomainBuilder PlaceC4()
        {
            Action("Place C4 on bunker")
                .Condition("hasC4", c => c.Has(WS.HasC4))
                .Condition("!c4Placed", c => !c.Has(WS.C4Placed))
                .Condition("at bunker door", c => c.AgentAt == Location.BunkerDoor)
                .Do(_ =>
                {
                    Console.WriteLine("PlaceC4");
                    return TaskStatus.Success;
                })
                .Effect("hasC4 := false", EffectType.PlanAndExecute, (c, t) => c.Set(WS.HasC4, false, t))
                .Effect("c4Placed := true", EffectType.PlanAndExecute, (c, t) => c.Set(WS.C4Placed, true, t))
            .End();
            return this;
        }

        public BunkerDomainBuilder Detonate()
        {
            Action("Detonate C4 (boom)")
                .Condition("c4Placed", c => c.Has(WS.C4Placed))
                .Condition("!bunkerBreached", c => !c.Has(WS.BunkerBreached))
                .Condition("at safe spot", c => c.AgentAt == Location.SafeSpot)
                .Do(_ =>
                {
                    Console.WriteLine("Detonate");
                    return TaskStatus.Success;
                })
                .Effect("bunkerBreached := true", EffectType.PlanAndExecute, (c, t) => c.Set(WS.BunkerBreached, true, t))
                .Effect("c4Placed := false", EffectType.PlanAndExecute, (c, t) => c.Set(WS.C4Placed, false, t))
            .End();
            return this;
        }

        public BunkerDomainBuilder PickUpStar()
        {
            Action("Pick up star")
                .Condition("!hasStar", c => !c.Has(WS.HasStar))
                .Condition("starPresent", c => c.Has(WS.StarPresent))
                .Condition("at star", c => c.AgentAt == Location.StarPos)
                .Do(_ =>
                {
                    Console.WriteLine("PickUpStar");
                    return TaskStatus.Success;
                })
                .Effect("hasStar := true", EffectType.PlanAndExecute, (c, t) => c.Set(WS.HasStar, true, t))
                .Effect("starPresent := false", EffectType.PlanAndExecute, (c, t) => c.Set(WS.StarPresent, false, t))
            .End();
            return this;
        }

        // ------------- "Methods" (compound tasks) -------------

        public BunkerDomainBuilder AcquireKeySequence()
        {
            Sequence("Acquire key");
            {
                Condition("!hasKey", c => !c.Has(WS.HasKey));
                MoveTo(Location.TableArea);
                PickUpKey();
            }
            End();
            return this;
        }

        public BunkerDomainBuilder AcquireC4Sequence()
        {
            Sequence("Acquire C4");
            {
                Condition("!hasC4", c => !c.Has(WS.HasC4));

                MoveTo(Location.StorageDoor);

                // Unlock if needed
                Select("Unlock if needed");
                {
                    // Already unlocked branch
                    Sequence("Already unlocked");
                    {
                        Condition("storageUnlocked", c => c.Has(WS.StorageUnlocked));
                        Succeed("Skip unlock");
                    }
                    End();

                    // Unlock now
                    Sequence("Unlock now");
                    {
                        Condition("!storageUnlocked", c => !c.Has(WS.StorageUnlocked));
                        // We are at the door due to previous MoveTo
                        UnlockStorage();
                    }
                    End();
                }
                End();

                MoveTo(Location.C4Table);
                PickUpC4();
            }
            End();
            return this;
        }

        public BunkerDomainBuilder BreachBunkerSequence()
        {
            Sequence("Breach bunker");
            {
                Condition("!bunkerBreached", c => !c.Has(WS.BunkerBreached));

                // If not placed, place at door
                Select("C4 already placed?");
                {
                    // Already placed
                    Sequence("Already placed");
                    {
                        Condition("c4Placed", c => c.Has(WS.C4Placed));
                        Succeed("Skip placing");
                    }
                    End();

                    // Need to place
                    Sequence("Place C4 now");
                    {
                        Condition("!c4Placed", c => !c.Has(WS.C4Placed));
                        MoveTo(Location.BunkerDoor);
                        PlaceC4();
                    }
                    End();
                }
                End();

                // Walk to safe spot and detonate
                MoveTo(Location.SafeSpot);
                Detonate();
            }
            End();
            return this;
        }

        public BunkerDomainBuilder GetStarSequence()
        {
            Sequence("Collect star");
            {
                Condition("need star", c => !c.Has(WS.HasStar) && c.Has(WS.StarPresent));
                MoveTo(Location.StarPos);
                PickUpStar();
            }
            End();
            return this;
        }

        public BunkerDomainBuilder Finish()
        {
            Select("Finish");
            {
                Action("Done")
                    .Do(ctx =>
                    {
                        Console.WriteLine("MISSION COMPLETE");
                        ctx.Done = true;
                        return TaskStatus.Continue; // keep planner ticking until loop exits
                    })
                .End();
            }
            End();
            return this;
        }
    }

    // ---------------------------------------
    // Main (assemble and run)
    // ---------------------------------------
    public static class Program
    {
        public static void Main()
        {
            // Build the domain: mimic your Mahler "MissionCollectStar"
            var domain = new BunkerDomainBuilder("Bunker + Star (Fluid HTN)")
                .AcquireKeySequence()
                .AcquireC4Sequence()
                .BreachBunkerSequence()
                .GetStarSequence()
                .Finish()
                .Build();

            // Context + initial state (mirrors your "initial" JS object)
            var ctx = new BunkerContext();
            ctx.WorldState[(int)WS.AgentAt] = (byte)Location.Courtyard;

            // World facts (informative)
            ctx.WorldState[(int)WS.KeyOnTable]    = 1; // true
            ctx.WorldState[(int)WS.C4Available]   = 1; // true
            ctx.WorldState[(int)WS.StarPresent]   = 1; // true

            // Inventory
            ctx.WorldState[(int)WS.HasKey]  = 0;
            ctx.WorldState[(int)WS.HasC4]   = 0;
            ctx.WorldState[(int)WS.HasStar] = 0;

            // Environment
            ctx.WorldState[(int)WS.StorageUnlocked] = 0;
            ctx.WorldState[(int)WS.C4Placed]        = 0;
            ctx.WorldState[(int)WS.BunkerBreached]  = 0;

            ctx.Init();

            var planner = new Planner();

            // Simple run loop (tick until Done)
            while (!ctx.Done)
            {
                planner.Tick(domain, ctx);
            }

            Console.WriteLine("\n--- FINAL STATE ---");
            Console.WriteLine($"AgentAt          = { (Location)ctx.WorldState[(int)WS.AgentAt] }");
            Console.WriteLine($"HasKey           = {ctx.WorldState[(int)WS.HasKey] == 1}");
            Console.WriteLine($"HasC4            = {ctx.WorldState[(int)WS.HasC4] == 1}");
            Console.WriteLine($"HasStar          = {ctx.WorldState[(int)WS.HasStar] == 1}");
            Console.WriteLine($"StorageUnlocked  = {ctx.WorldState[(int)WS.StorageUnlocked] == 1}");
            Console.WriteLine($"C4Placed         = {ctx.WorldState[(int)WS.C4Placed] == 1}");
            Console.WriteLine($"BunkerBreached   = {ctx.WorldState[(int)WS.BunkerBreached] == 1}");
        }
    }
}
```

---

## Mapping from your Mahler code → Fluid HTN

* **State & world graph**
  *Mahler*: plain JS object + gated adjacency via functions.
  *Fluid*: `BunkerContext` holds world state (`byte[]`) and exposes the same gated adjacency and BFS functions. Effects set `WS` flags (PlanAndExecute) to model predicted + executed state changes. This is the standard pattern in Fluid HTN contexts. ([GitHub][1])

* **Primitive actions**
  `PickUpKey`, `UnlockStorage`, `PickUpC4`, `PlaceC4`, `Detonate`, `PickUpStar` → each is a **primitive action** with:

  * *Conditions* (preconditions)
  * *Do* (logs; return Success)
  * *Effects* (PlanAndExecute — e.g., `hasKey := true`)

* **Movement**
  Your `Move` and `GoTo` are collapsed into one primitive **MoveTo(target)** that:

  * checks `IsReachable(current, target)` using your BFS + gates,
  * logs the path,
  * sets `AgentAt := target` (PlanAndExecute).
    This mirrors your “teleport when traversable” comment, and keeps the HTN simple and robust. If you prefer the “one edge per step” flavor, you can instead (a) make MoveTo require `IsImmediatelyReachable` and (b) write a custom compound that decomposes into a list of `MoveTo(next)` primitives per step (Fluid HTN lets you extend compound tasks — see the README’s custom selector and builder extensions). ([GitHub][1])

* **Compound tasks (“methods”)**
  `AcquireKey`, `AcquireC4`, `BreachBunker`, `GetStar`, `MissionCollectStar` → **Sequences** composed with a small **Select** to handle optional steps (e.g., unlock only if needed, place C4 only if not already placed). This is idiomatic Fluid HTN builder usage. ([GitHub][1])

---

## What you’ll see when you run

A console log similar to:

```
MoveTo: Courtyard -> StorageDoor
UnlockStorage
MoveTo: StorageDoor -> StorageInterior -> C4Table
PickUpC4
MoveTo: StorageInterior -> StorageDoor -> SafeSpot
... (place at door if not placed)
Detonate
MoveTo: BunkerDoor -> BunkerInterior -> StarPos
PickUpStar
MISSION COMPLETE

--- FINAL STATE ---
AgentAt          = StarPos
HasKey           = True
HasC4            = False
HasStar          = True
StorageUnlocked  = True
C4Placed         = False
BunkerBreached   = True
```

(Exact path lines depend on when we log relative to the effects.)

---

## Adapting / extending

* **“Stepwise” movement**: If you want each edge as a separate primitive (like your `GoTo` → many `Move`), change `MoveTo`’s condition to `IsImmediatelyReachable` and implement a custom compound `PathTo(dest)` that, *during decomposition*, enumerates the BFS path and injects a series of `MoveTo(next)` primitives. Fluid HTN supports custom compound tasks and domain builder extensions for that pattern. ([GitHub][1])

* **Debug planning**: If you want decomposition logs or MTR (Method Traversal Record), enable the debug flags in your `BunkerContext` (see README sections on logging and debugging). ([GitHub][1])

---

### References (for API style & patterns)

* Fluid HTN **README** — world state, context, DomainBuilder, conditions/operators/effects, custom builder extensions. ([GitHub][1])
* **Troll Bridge** example repository — shows real-world builder extensions & operators used from source. ([GitHub][2])

If you want, I can also produce a variant that mirrors your exact `GoTo → Move(step)` decomposition step-by-step.

[1]: https://github.com/ptrefall/fluid-hierarchical-task-network "GitHub - ptrefall/fluid-hierarchical-task-network: A simple HTN planner based around the principles of the Builder pattern."
[2]: https://github.com/ptrefall/fluid-troll-bridge "GitHub - ptrefall/fluid-troll-bridge: Example for Fluid HTN"
