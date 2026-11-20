const globalSetup = process.env.BB_FIXTURE_GLOBAL_SETUP;

export default {
  test: {
    include: ["*.fixture.ts"],
    pool: "forks",
    globalSetup: globalSetup ? [globalSetup] : [],
  },
};
