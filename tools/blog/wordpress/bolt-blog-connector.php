<?php
/**
 * Plugin Name: Bolt Blog Connector
 * Description: Publishes this WordPress site's posts to boltanswering.com/blog. Adds search title/description fields, triggers a site rebuild on publish, and keeps this copy of the blog out of search engines.
 * Version: 1.0.0
 * Author: Bolt
 * License: Proprietary
 *
 * Setup: Settings → Bolt Blog. Paste a GitHub fine-grained token that has
 * "Contents: Read and write" on the site repository only. See tools/blog/README.md.
 */

if (!defined('ABSPATH')) {
    exit;
}

const BOLT_BLOG_OPT = 'bolt_blog_connector';

function bolt_blog_settings() {
    $defaults = array(
        'repo'     => 'kanonarmstrong/Bolt_Answering_Site',
        'token'    => '',
        'site_url' => 'https://www.boltanswering.com',
        'redirect' => '1',
    );
    return wp_parse_args(get_option(BOLT_BLOG_OPT, array()), $defaults);
}

/* 1. Search title + description fields, exposed to the REST API the build reads. */
add_action('init', function () {
    foreach (array('bolt_seo_title', 'bolt_seo_description') as $key) {
        register_post_meta('post', $key, array(
            'type'              => 'string',
            'single'            => true,
            'show_in_rest'      => true,
            'sanitize_callback' => 'sanitize_text_field',
            'auth_callback'     => function () { return current_user_can('edit_posts'); },
        ));
    }
});

add_action('add_meta_boxes', function () {
    add_meta_box('bolt_seo', 'Search & AI (Bolt)', 'bolt_blog_seo_box', 'post', 'side', 'high');
});

function bolt_blog_seo_box($post) {
    wp_nonce_field('bolt_seo_save', 'bolt_seo_nonce');
    $title = get_post_meta($post->ID, 'bolt_seo_title', true);
    $desc  = get_post_meta($post->ID, 'bolt_seo_description', true);
    echo '<p><label for="bolt_seo_title"><strong>Search title</strong></label><br>';
    echo '<input type="text" id="bolt_seo_title" name="bolt_seo_title" value="' . esc_attr($title) . '" style="width:100%" maxlength="70"></p>';
    echo '<p class="description">Shown in Google and AI search results. Aim for 50–60 characters. Leave blank to use the post title.</p>';
    echo '<p><label for="bolt_seo_description"><strong>Search description</strong></label><br>';
    echo '<textarea id="bolt_seo_description" name="bolt_seo_description" rows="4" style="width:100%" maxlength="170">' . esc_textarea($desc) . '</textarea></p>';
    echo '<p class="description">One or two sentences, about 150 characters. Leave blank to use the excerpt.</p>';
}

add_action('save_post_post', function ($post_id) {
    if (!isset($_POST['bolt_seo_nonce']) || !wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['bolt_seo_nonce'])), 'bolt_seo_save')) {
        return;
    }
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
        return;
    }
    if (!current_user_can('edit_post', $post_id)) {
        return;
    }
    foreach (array('bolt_seo_title', 'bolt_seo_description') as $key) {
        if (isset($_POST[$key])) {
            update_post_meta($post_id, $key, sanitize_text_field(wp_unslash($_POST[$key])));
        }
    }
});

/* 2. Rebuild the public blog whenever a published post changes or leaves "published". */
function bolt_blog_trigger_rebuild($reason, $post = null) {
    $s = bolt_blog_settings();
    if (empty($s['token']) || empty($s['repo'])) {
        return new WP_Error('bolt_blog_unconfigured', 'Bolt Blog: add a GitHub token under Settings → Bolt Blog.');
    }
    $payload = array(
        'event_type'     => 'wp_publish',
        'client_payload' => array(
            'reason'  => $reason,
            'post_id' => $post ? $post->ID : null,
            'slug'    => $post ? $post->post_name : null,
        ),
    );
    return wp_remote_post('https://api.github.com/repos/' . $s['repo'] . '/dispatches', array(
        'timeout'  => 5,
        'blocking' => true, // a non-blocking request can be dropped on some hosts
        'headers'  => array(
            'Authorization'        => 'Bearer ' . $s['token'],
            'Accept'               => 'application/vnd.github+json',
            'X-GitHub-Api-Version' => '2022-11-28',
            'User-Agent'           => 'bolt-blog-connector',
        ),
        'body'     => wp_json_encode($payload),
    ));
}

add_action('transition_post_status', function ($new, $old, $post) {
    if ($post->post_type !== 'post' || wp_is_post_revision($post) || wp_is_post_autosave($post)) {
        return;
    }
    if ($new === 'publish' || $old === 'publish') {
        bolt_blog_trigger_rebuild($new === 'publish' ? ($old === 'publish' ? 'update' : 'publish') : 'unpublish', $post);
    }
}, 10, 3);

/* Image alt text and edits to a published post's category or media also matter. */
add_action('edit_attachment', function ($id) {
    if (get_post_parent($id) && get_post_status(get_post_parent($id)) === 'publish') {
        bolt_blog_trigger_rebuild('media', get_post(get_post_parent($id)));
    }
});

/* 3. Settings page. */
add_action('admin_menu', function () {
    add_options_page('Bolt Blog', 'Bolt Blog', 'manage_options', 'bolt-blog', 'bolt_blog_settings_page');
});

function bolt_blog_settings_page() {
    if (!current_user_can('manage_options')) {
        return;
    }
    $s = bolt_blog_settings();
    $notice = '';
    if (isset($_POST['bolt_blog_save']) && check_admin_referer('bolt_blog_settings')) {
        $s['repo']     = sanitize_text_field(wp_unslash($_POST['repo'] ?? $s['repo']));
        $s['site_url'] = esc_url_raw(wp_unslash($_POST['site_url'] ?? $s['site_url']));
        $s['redirect'] = isset($_POST['redirect']) ? '1' : '0';
        $new_token = trim(sanitize_text_field(wp_unslash($_POST['token'] ?? '')));
        if ($new_token !== '') {
            $s['token'] = $new_token; // never shown again after saving
        }
        update_option(BOLT_BLOG_OPT, $s, false);
        $notice = 'Saved.';
    }
    if (isset($_POST['bolt_blog_test']) && check_admin_referer('bolt_blog_settings')) {
        $res = bolt_blog_trigger_rebuild('test');
        if (is_wp_error($res)) {
            $notice = esc_html($res->get_error_message());
        } else {
            $code = wp_remote_retrieve_response_code($res);
            $notice = $code === 204 ? 'Rebuild requested. Check the Actions tab on GitHub in about a minute.' : 'GitHub said ' . intval($code) . '. Check the token and repository.';
        }
    }
    echo '<div class="wrap"><h1>Bolt Blog</h1>';
    if ($notice) {
        echo '<div class="notice notice-info"><p>' . esc_html($notice) . '</p></div>';
    }
    echo '<form method="post">';
    wp_nonce_field('bolt_blog_settings');
    echo '<table class="form-table">';
    echo '<tr><th><label for="repo">GitHub repository</label></th><td><input id="repo" name="repo" class="regular-text" value="' . esc_attr($s['repo']) . '"></td></tr>';
    echo '<tr><th><label for="token">GitHub token</label></th><td><input id="token" name="token" type="password" class="regular-text" autocomplete="new-password" placeholder="' . ($s['token'] ? 'Saved. Paste a new one to replace it.' : 'github_pat_…') . '">';
    echo '<p class="description">Fine-grained token, this repository only, permission "Contents: Read and write".</p></td></tr>';
    echo '<tr><th><label for="site_url">Public site</label></th><td><input id="site_url" name="site_url" class="regular-text" value="' . esc_attr($s['site_url']) . '"></td></tr>';
    echo '<tr><th>Redirect visitors</th><td><label><input type="checkbox" name="redirect" value="1" ' . checked($s['redirect'], '1', false) . '> Send visitors of this WordPress site to the public blog (recommended)</label></td></tr>';
    echo '</table>';
    submit_button('Save settings', 'primary', 'bolt_blog_save', false);
    echo ' ';
    submit_button('Send a test rebuild', 'secondary', 'bolt_blog_test', false);
    echo '</form></div>';
}

/* 4. Keep this WordPress copy out of search: noindex everything, and send visitors to
      the public page. Logged-in users, previews, the REST API, admin and cron are untouched. */
add_filter('wp_robots', function ($robots) {
    $robots['noindex'] = true;
    $robots['nofollow'] = true;
    return $robots;
});

add_action('send_headers', function () {
    if (!is_admin()) {
        header('X-Robots-Tag: noindex, nofollow', true);
    }
});

add_action('template_redirect', function () {
    $s = bolt_blog_settings();
    if ($s['redirect'] !== '1' || is_user_logged_in() || is_preview() || is_admin() || wp_doing_ajax() || wp_doing_cron()) {
        return;
    }
    $base = untrailingslashit($s['site_url']) . '/blog/';
    if (is_singular('post')) {
        $target = $base . get_post_field('post_name', get_queried_object_id()) . '/';
    } elseif (is_category()) {
        $target = $base . 'category/' . get_queried_object()->slug . '/';
    } else {
        $target = $base;
    }
    wp_redirect($target, 301, 'Bolt Blog');
    exit;
});
