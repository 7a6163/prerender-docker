const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { strippedParams, stripQueryParams, DEFAULT_STRIPPED_PARAMS } = require('../../url-normalize');

const strip = (url, raw) => stripQueryParams(url, strippedParams(raw));

describe('stripQueryParams', () => {
    it('removes tracking parameters and keeps the rest', () => {
        assert.equal(
            strip('https://a.com/p?id=7&utm_source=fb&fbclid=xyz&page=2'),
            'https://a.com/p?id=7&page=2'
        );
    });

    it('matches parameter names case-insensitively', () => {
        assert.equal(strip('https://a.com/p?UTM_Source=fb&keep=1'), 'https://a.com/p?keep=1');
    });

    it('leaves a URL with nothing to strip byte-identical', () => {
        for (const url of ['https://a.com/p?id=7', 'https://a.com/p', 'https://a.com/']) {
            assert.equal(strip(url), url);
        }
    });

    it('does not leave a bare ? when the last parameter goes', () => {
        assert.equal(strip('https://a.com/p?fbclid=xyz'), 'https://a.com/p');
        assert.equal(strip('https://a.com/p?fbclid=xyz#top'), 'https://a.com/p#top');
    });

    it('preserves the fragment, including hashbang routes', () => {
        assert.equal(strip('https://a.com/#!/route?gclid=1&x=2'), 'https://a.com/#!/route?gclid=1&x=2');
        assert.equal(strip('https://a.com/p?gclid=1&x=2#!/r'), 'https://a.com/p?x=2#!/r');
    });

    it('returns an unparseable URL untouched', () => {
        assert.equal(strip('not a url?utm_source=x'), 'not a url?utm_source=x');
    });

    it('strips nothing when the list is empty, and honours a custom list', () => {
        assert.equal(strip('https://a.com/p?utm_source=fb', ''), 'https://a.com/p?utm_source=fb');
        assert.equal(strip('https://a.com/p?ref=x&utm_source=fb', 'ref'), 'https://a.com/p?utm_source=fb');
    });

    it('ships a default list covering the click ids that actually appear', () => {
        for (const p of ['utm_source', 'fbclid', 'gclid', 'msclkid', 'ttclid', 'igshid']) {
            assert.ok(DEFAULT_STRIPPED_PARAMS.includes(p), `${p} missing from defaults`);
        }
    });
});
