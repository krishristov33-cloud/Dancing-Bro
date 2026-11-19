// Build and publish dist/ to the gh-pages branch (GitHub Pages serves it from there).
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const run = (cmd, cwd) => execSync(cmd, { stdio: 'inherit', cwd });
const remote = execSync('git remote get-url origin').toString().trim();
run('npm run build');
writeFileSync('dist/.nojekyll', '');
run('git init -q -b gh-pages', 'dist');
run('git add -A', 'dist');
run('git -c user.name=deploy -c user.email=deploy@users.noreply.github.com commit -q -m "Deploy"', 'dist');
run(`git push -f -q ${remote} gh-pages`, 'dist');
console.log('Deployed to gh-pages');
