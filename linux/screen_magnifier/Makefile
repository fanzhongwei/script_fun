CC ?= gcc
CFLAGS ?= -O2 -Wall -Wextra -std=c11 -D_DEFAULT_SOURCE
XFT_CFLAGS := $(shell pkg-config --cflags xft 2>/dev/null)
ifeq ($(XFT_CFLAGS),)
XFT_CFLAGS := -I/usr/include/freetype2
endif
LIBS = -lXft -lfontconfig -lfreetype -lXrender -lXcomposite -lXext -lXfixes -lXrandr -lX11 -lm

.PHONY: all test clean

all: magnifier

magnifier: magnifier.c
	$(CC) $(CFLAGS) $(XFT_CFLAGS) -o $@ magnifier.c $(LIBS)

test: magnifier.c
	$(CC) $(CFLAGS) -DGEOM_TEST -o magnifier_test magnifier.c -lm
	./magnifier_test
	rm -f magnifier_test

clean:
	rm -f magnifier magnifier_test
