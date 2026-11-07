import { describe, expect, it } from "vitest";
import { calculateCategoryProgress, calculateOverallProgress, getStatusLabel, projectTasks } from "./projectCompletion";

describe("project completion calculations", () => {
  it("calculates overall progress from completed tasks divided by total scope", () => {
    const progress = calculateOverallProgress(projectTasks);
    expect(progress.completed).toBe(projectTasks.filter((task) => task.state === "completed").length);
    expect(progress.percent).toBe(Math.round((progress.completed / progress.total) * 100));
    expect(progress.percent).toBeLessThan(100);
  });

  it("calculates category percentages from actual task counts", () => {
    const categories = calculateCategoryProgress(projectTasks);
    const testing = categories.find((item) => item.category === "testing");
    const expectedTestingTasks = projectTasks.filter((t) => t.category === "testing");
    const expectedCompleted = expectedTestingTasks.filter((t) => t.state === "completed").length;
    expect(testing?.completed).toBe(expectedCompleted);
    expect(testing?.total).toBe(expectedTestingTasks.length);
    expect(testing?.percent).toBe(Math.round((expectedCompleted / expectedTestingTasks.length) * 100));
  });

  it("maps status labels by requested ranges", () => {
    expect(getStatusLabel(0)).toBe("Not Started");
    expect(getStatusLabel(50)).toBe("In Progress");
    expect(getStatusLabel(82)).toBe("Near Completion");
    expect(getStatusLabel(96)).toBe("Ready for Deployment");
  });
});
