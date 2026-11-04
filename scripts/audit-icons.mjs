import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Data, NtExecutable, NtExecutableResource, Resource } from 'resedit';

// Compare actual RT_GROUP_ICON / RT_ICON data in the first (shell default) group with our ICO.
const expected = Data.IconFile.from(await fs.readFile('build/icon.ico')).icons;
const files = process.argv.slice(2);
assert.ok(files.length, 'Pass the paths of the packaged Windows executables.');
for (const file of files) {
  const pe = NtExecutable.from(await fs.readFile(file));
  const { entries } = NtExecutableResource.from(pe);
  const [group] = Resource.IconGroupEntry.fromEntries(entries);
  assert.ok(group, 'Missing icon group: ' + path.basename(file));
  const images = group.getIconItemsFromEntries(entries);
  assert.equal(images.length, expected.length);
  for (const { data } of expected) {
    // PE group dimensions occupy one byte. Zero encodes 256 pixels.
    const image = images.find(
      (item) => (item.width || 256) === data.width && (item.height || 256) === data.height,
    );
    assert.ok(image?.isRaw() && data.isRaw(), 'Missing PNG icon frame ' + data.width);
    assert.ok(
      Buffer.from(image.bin).equals(Buffer.from(data.bin)),
      'Icon mismatch: ' + path.basename(file) + ' at ' + data.width,
    );
  }
  console.log(path.basename(file) + ': ' + images.length + ' embedded icon frames match.');
}
