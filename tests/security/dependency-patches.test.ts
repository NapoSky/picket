const { verifyDependencyPatches } = require('../../scripts/check-dependency-patches.cjs') as {
  verifyDependencyPatches(): number;
};

it('verifies the installed Jest dependency against prototype poisoning and merge regressions', () => {
  expect(verifyDependencyPatches()).toBe(26);
});
