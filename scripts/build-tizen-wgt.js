/**
 * Builds a SIGNED Samsung Tizen widget (.wgt) without Tizen Studio.
 *
 * Uses Samsung's own @tizentv/webide-common-tizentv library (the engine
 * behind their VS Code extension): author certificate via node-forge,
 * W3C XML-DSig signatures, zip packaging. The Tizen developer CA and the
 * public distributor certificate are downloaded on demand by the library.
 *
 * Usage:  TIZEN_CERT_PASSWORD=<pass> node scripts/build-tizen-wgt.js
 * Output: dist-tizen/signage-tizen.wgt
 */
const path = require('path');
const fs = require('fs');
const { TVWebApp, TizenCertManager, ProfileManager } = require('@tizentv/webide-common-tizentv');

const repoRoot = path.resolve(__dirname, '..');
const appDir = path.resolve(repoRoot, 'tv-app-tizen');
const outDir = path.resolve(repoRoot, 'dist-tizen');
const resourceDir = path.resolve(outDir, 'signing-resource');
const password = process.env.TIZEN_CERT_PASSWORD || 'signage-local-build';

(async () => {
  fs.mkdirSync(resourceDir, { recursive: true });

  // 1. Author certificate (signed by the Tizen developer CA)
  const certMgr = new TizenCertManager(resourceDir);
  await certMgr.init();
  certMgr.createCert({
    keyFileName: 'signage-author',
    authorName: 'SignageManager',
    authorPassword: password,
    countryInfo: 'IT',
    stateInfo: '',
    cityInfo: '',
    organizationInfo: 'FrozenBit',
    departmentInfo: '',
    emailInfo: '',
  });
  const authorP12 = path.resolve(resourceDir, 'Author', 'signage-author.p12');
  if (!fs.existsSync(authorP12)) throw new Error('author certificate was not created: ' + authorP12);

  // 2. Signing profile (author + default public distributor)
  const profileMgr = new ProfileManager(resourceDir);
  await profileMgr.registerProfile(
    'signage',
    { authorCA: certMgr.caCertPath, authorCertPath: authorP12, authorPassword: password },
    {
      distributorCA: certMgr.distributorPublicCA,
      distributorCertPath: certMgr.distributorPublicSigner,
      distributorPassword: certMgr.distributorPassword,
    }
  );
  profileMgr.setActivateProfile('signage');

  // 3. Sign the widget dir (author-signature.xml + signature1.xml) and zip it
  const app = new TVWebApp('signage-tizen', appDir, 'signage001.SignagePlayer');
  await app.buildWidget(profileMgr.profilePath, '');

  const built = path.resolve(appDir, 'signage-tizen.wgt');
  if (!fs.existsSync(built)) throw new Error('wgt was not produced: ' + built);
  fs.copyFileSync(built, path.resolve(outDir, 'signage-tizen.wgt'));
  fs.unlinkSync(built);
  console.log('OK: dist-tizen/signage-tizen.wgt');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
