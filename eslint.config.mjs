import DiscourseRecommended from "@discourse/lint-configs/eslint";

export default [
  ...DiscourseRecommended,
  { ignores: [".test-work/**"] },
  {
    rules: {
      "no-console": "off",
    },
  },
];
