# Selene — common tasks. Requires Node 20+, Python 3.11+ (numpy, pillow, lz4), Chrome/Chromium for Playwright.
PY ?= python3

.PHONY: web faces test enclosure all

web:            ## bundle the single-file simulator into dist/index.html (the Dockerfile builds the PWA variant)
	node web/build.mjs

faces:          ## regenerate firmware face assets from shared/faces.js
	node tools/gen_segments.mjs
	node tools/render_faces.mjs 720 build/faces
	$(PY) tools/pack_faces.py build/faces firmware/components/selene --preview build/preview

test:           ## astronomy vs PyEphem, C++ vs JS (astro + watch logic), renderer equivalence
	node tools/astro_cases.mjs | $(PY) tools/check_astro.py
	g++ -O2 -std=c++17 -o firmware/tests/astro_host firmware/tests/astro_host.cpp firmware/components/selene/astro.cpp
	g++ -O2 -std=c++17 -o firmware/tests/watch_host firmware/tests/watch_host.cpp firmware/components/selene/watch.cpp firmware/components/selene/astro.cpp
	g++ -O2 -std=c++17 -o firmware/tests/render_host firmware/tests/render_host.cpp firmware/components/selene/renderer.cpp firmware/components/selene/watch.cpp firmware/components/selene/astro.cpp
	node tools/diff_watch.mjs 1
	cd firmware/tests && ./render_host

enclosure:      ## export STEP/STL/3MF (needs cadquery)
	cd enclosure && $(PY) selene_enclosure.py

all: web faces test
