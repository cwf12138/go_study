# IELTS / TOEFL catalog source

The generated `ielts.json` and `toefl.json` files are filtered from the
`ielts` and `toefl` exam tags in the ECDICT CSV dataset. Entries are ordered by
ECDICT's contemporary-corpus frequency field and then alphabetically.

- Source: https://github.com/skywind3000/ECDICT
- Upstream data file: `ecdict.csv`
- License: MIT
- Generator: `tools/build_exam_catalogs.go`

The source's copyright and license text are preserved in
`ECDICT-LICENSE.txt`. IELTS and TOEFL are trademarks of their respective
owners; the catalog names only describe the exam tags supplied by ECDICT and
do not imply endorsement.
