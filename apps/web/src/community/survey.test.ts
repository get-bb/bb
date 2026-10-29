import { describe, expect, it } from "vitest";
import { surveyAnswers, validateSurvey } from "./survey";

const contact = {
  email: ["ada@example.test"],
  discovery: ["GitHub"],
  work: ["Just me"],
  company_size: ["1–50"],
  role: ["Student"],
  love: ["Plugins"],
  improve: ["Faster startup"],
  team_adopt: ["Admin approval"],
  community: ["Get help when I'm stuck"],
  city: ["Austin, USA"],
  meetup: ["Maybe"],
};

describe("community survey submission rules", () => {
  it.each(["", "I don't use bb for work", "Just me", "2–4 people", "5 or more", "I'm not sure"])("conditions company size on %s", (work) => {
    const values = { ...contact, work: work ? [work] : [], company_size: [] };
    const shown = Boolean(work && work !== "I don't use bb for work");
    expect(Boolean(validateSurvey(values).company_size)).toBe(shown);
    expect(surveyAnswers({ ...values, company_size: ["201–999"] }).company_size)
      .toEqual(shown ? ["201–999"] : undefined);
  });

  it("requires every shown question and valid contact details", () => {
    expect(validateSurvey(contact)).toEqual({});
    const missing = validateSurvey({});
    expect(missing.email).toBe("Please enter your email.");
    expect(missing.love).toBe("Please answer this question.");
    expect(missing.team_improve).toBeUndefined();
    expect(missing.team_adopt).toBeUndefined();
    expect(
      validateSurvey({ ...contact, team_adopt: [] }).team_adopt,
    ).toBe("Please answer this question.");
    expect(
      validateSurvey({ ...contact, work: ["5 or more"], team_adopt: [], team_improve: ["Roles"] }),
    ).toEqual({});
    expect(
      validateSurvey({ ...contact, work: ["2–4 people"] }).team_improve,
    ).toBe("Please answer this question.");
    expect(
      validateSurvey({ ...contact, improve: ["   "] }).improve,
    ).toBeTruthy();
    expect(
      validateSurvey({ ...contact, discovery: ["Other"] }).discovery_other,
    ).toBeTruthy();
    expect(
      validateSurvey({ ...contact, community: ["Other"] }).community_other,
    ).toBeTruthy();
    expect(
      validateSurvey({
        ...contact,
        community: ["Other"],
        community_other: ["Hackathons"],
      }),
    ).toEqual({});
    expect(
      validateSurvey({ ...contact, email: ["invalid"] }).email,
    ).toBeTruthy();
    expect(
      validateSurvey({
        ...contact,
        email: ["a@example.test", "b@example.test"],
      }).email,
    ).toBeTruthy();
  });
  it("asks the meetup question as one attend-or-organize answer", () => {
    for (const meetup of [["Yes, and I'd help organize it"], ["Yes, I'd come"], ["Maybe"], ["No"]]) {
      expect(validateSurvey({ ...contact, meetup })).toEqual({});
    }
    expect(validateSurvey({ ...contact, meetup: ["Yes, I'd come", "No"] }).meetup).toBeTruthy();
    expect(validateSurvey({ ...contact, meetup: ["I'd come"] }).meetup).toBeTruthy();
    expect(
      validateSurvey({ ...contact, role: ["Invented"] }).role,
    ).toBeTruthy();
    expect(
      validateSurvey({ ...contact, city: ["x".repeat(251)] }).city,
    ).toBeTruthy();
  });
  it("allows up to three listed community choices", () => {
    expect(
      validateSurvey({
        ...contact,
        community: [
          "See how other people use bb",
          "Get help when I'm stuck",
          "Build things with other bb users",
        ],
      }),
    ).toEqual({});
    for (const community of [
      ["Invented"],
      ["See how other people use bb", "See how other people use bb"],
      [
        "See how other people use bb",
        "Get help when I'm stuck",
        "Build things with other bb users",
        "Meet other bb users, online or in person",
      ],
    ]) {
      expect(validateSurvey({ ...contact, community }).community).toBeTruthy();
    }
  });
  it("stores contact and selected Other detail with answers, excluding unrelated fields", () => {
    expect(
      surveyAnswers({
        ...contact,
        discovery: ["Other"],
        discovery_other: ["Example"],
        role: ["Student"],
        community_other: ["Ignored"],
        role_other: ["Ignored"],
        submission_id: ["not-an-answer"],
        address: ["not-stored"],
        name: ["not-stored"],
      }),
    ).toEqual({
      ...contact,
      discovery: ["Other"],
      discovery_other: ["Example"],
      role: ["Student"],
    });
  });
});
