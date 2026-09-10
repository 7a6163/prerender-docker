'use strict';

// Tracking parameters make one page look like many: each distinct query string
// is its own lock, its own render and its own cache entry, so a single shared
// link with a click id can multiply into hundreds of copies of the same page.
// Removing them changes nothing a crawler sees.
const DEFAULT_STRIPPED_PARAMS = [
    // Google / Analytics
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
    'utm_source_platform', 'utm_creative_format', 'utm_marketing_tactic',
    '_ga', '_gl', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid',
    // Meta / LINE / TikTok / X / LinkedIn / Microsoft / Yandex
    'fbclid', 'fb_action_ids', 'fb_action_types', 'fb_source', 'igshid', 'igsh',
    'ttclid', 'twclid', 'li_fat_id', 'msclkid', 'yclid', 'openExternalBrowser',
    // Mail / affiliate
    'mc_cid', 'mc_eid', 'mkt_tok', 'vero_id', 'vero_conv', '_hsenc', '_hsmi',
    'hsa_cam', 'hsa_grp', 'hsa_ad', 'ref_src', 'ref_url'
];

/**
 * Query parameters to strip. An unset variable uses the defaults above; an
 * empty one strips nothing, which is why this is not a `||` fallback.
 */
const strippedParams = (raw) => (raw === undefined ? DEFAULT_STRIPPED_PARAMS : raw.split(','))
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);

/**
 * Removes the given query parameters from a URL. Comparison is
 * case-insensitive, parameter order and everything else is preserved, and a URL
 * that cannot be parsed comes back untouched - the renderer rejects it anyway.
 */
const stripQueryParams = (rawUrl, params) => {
    if (!params.length || !rawUrl || !rawUrl.includes('?')) return rawUrl;

    let url;
    try {
        url = new URL(rawUrl);
    } catch {
        return rawUrl;
    }

    let stripped = false;
    for (const name of [...url.searchParams.keys()]) {
        if (params.includes(name.toLowerCase())) {
            url.searchParams.delete(name);
            stripped = true;
        }
    }

    if (!stripped) return rawUrl;

    // A URL left with no parameters keeps a bare "?" from toString(), which
    // would be a second cache key for the same page
    return url.searchParams.size ? url.toString() : url.toString().replace(/\?(?=#|$)/, '');
};

module.exports = { DEFAULT_STRIPPED_PARAMS, strippedParams, stripQueryParams };
