const fs = require('fs');
const path = require('path');
// Manual list of files to fix
const files = [
  'backend/src/modules/cookieSecurityModule.ts',
  'backend/src/modules/crawlerModule.ts', 
  'backend/src/modules/directoryDiscoveryModule.ts',
  'backend/src/modules/httpHeaderModule.ts',
  'backend/src/modules/portScanModule.ts',
  'backend/src/modules/sensitiveInfoModule.ts',
  'backend/src/modules/sqlInjectionModule.ts',
  'backend/src/modules/sslTlsModule.ts',
  'backend/src/modules/xssModule.ts',
].map(f => path.join(__dirname, f));

let totalFixed = 0;

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  
  // We need to fix: .insert(withId({  ...  }));   where it currently ends with  });
  // The pattern: after .insert(withId({ the block ends with }); but should be }));
  // Strategy: find all .insert(withId({ and count braces to find the matching close
  
  let result = '';
  let i = 0;
  let fixCount = 0;
  
  while (i < content.length) {
    // Look for .insert(withId({
    const marker = '.insert(withId({';
    const idx = content.indexOf(marker, i);
    
    if (idx === -1) {
      result += content.slice(i);
      break;
    }
    
    // Copy up to and including the marker
    result += content.slice(i, idx + marker.length);
    i = idx + marker.length;
    
    // Now count braces to find the matching }
    let depth = 1; // we already consumed the opening {
    let j = i;
    
    while (j < content.length && depth > 0) {
      if (content[j] === '{') depth++;
      else if (content[j] === '}') depth--;
      j++;
    }
    
    // j now points just after the matching }
    // content[j-1] is the matching }
    // Check what follows: should be ); or );\n but we need ));
    const after = content.slice(j).trimStart();
    
    result += content.slice(i, j); // the body including closing }
    i = j;
    
    // Now i points at the character after }
    // Skip whitespace and check for );
    let k = i;
    while (k < content.length && (content[k] === ' ' || content[k] === '\r')) k++;
    
    if (content[k] === ')' && content[k+1] === ';') {
      // Already has )); — don't add another
      result += content.slice(i, k+2);
      i = k+2;
    } else if (content[k] === ';') {
      // Missing the closing ) — add it
      result += ')' + content.slice(i, k+1);
      i = k+1;
      fixCount++;
    } else {
      // Unknown — just copy as-is
      result += content.slice(i, k);
      i = k;
    }
  }
  
  if (fixCount > 0) {
    fs.writeFileSync(file, result, 'utf8');
    console.log(`Fixed ${fixCount} insert(withId) calls in ${path.basename(file)}`);
    totalFixed += fixCount;
  } else {
    console.log(`No changes needed in ${path.basename(file)}`);
  }
}

console.log(`\nTotal fixes: ${totalFixed}`);
