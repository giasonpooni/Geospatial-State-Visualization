# Proposed licensing policy — transition blocked pending review

This proposal does not replace or amend `LICENSE`. The existing GNU General
Public License v3 text and the README's GPLv3 declaration are retained.
No proprietary transition is authorized by this document, and it makes no
claim about current repository visibility.

The audited base revision is
`4554806c2ae03c6ac345a91f87fd02293581c5ca`. The repository has carried its
current GPL license text since the initial commit
`a8c5f7f0365ef0c968f1006051bc2a90bc7b603f`. Licenses already granted for those
versions remain governed by their terms. Restricting future repository access
does not withdraw earlier GPL permissions or retrieve existing copies.

## Conditions before any proposed future transition

A proprietary license for future original material would require unequivocal
authority from all relevant rights holders and legal review of the affected
code, contributions, dependencies, data, and proposed combination. Git author
names and automated coauthor records do not establish that authority.

Until those conditions are met, preserve the GPL text, existing attribution,
and third-party terms. Do not replace the root license, remove historical
license records, or label the existing GPL distribution wholly proprietary.
If a transition is later approved, its scope, covered revision, effective
date, authorized rights holders, and remaining exceptions must be explicit;
earlier license grants remain unaffected.

## Independently licensed components and data

Three.js retains its MIT terms, topojson-client its ISC terms, and the build
dependencies their own licenses. Preserve applicable license and copyright
notices in any distribution. The top-level GPL text does not replace them.

The repository attributes the country and land datasets to Natural Earth via
world-atlas and describes Natural Earth as public-domain data. Preserve those
source declarations and user-interface attributions. The audited files do
not pin the exact upstream world-atlas data release; verify that provenance
and any additional dataset terms before extending a licensing claim to all
bundled data.

The npm `private: true` field only prevents accidental package publication.
Repository access, deployment, and data handling remain separate decisions.
