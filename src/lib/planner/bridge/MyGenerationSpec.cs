using TypeGen.Core.SpecGeneration;

namespace FluidHtnWasm
{
    public class MyGenerationSpec : GenerationSpec
    {
        public MyGenerationSpec()
        {
            AddClass<PlannerBridge.BunkerPlanRequest>();
            AddClass<PlannerBridge.BunkerInitial>();
            AddClass<PlannerBridge.BunkerGoal>();
            AddClass<PlannerBridge.BunkerState>();
            AddClass<PlannerBridge.PlanResultJson>();
            AddEnum<PlannerBridge.MyWorldState>();
        }
    }
}


