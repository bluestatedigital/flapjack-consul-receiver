"use strict";

var path   = require("path");
var Q      = require("q");
var semver = require("semver-utils");

module.exports = function(grunt) {
    var targetDir = path.resolve("target");
    var packageRoot = path.join(targetDir, "package-root");

    // Load plugins
    require("time-grunt")(grunt);
    
    grunt.loadNpmTasks("grunt-contrib-jshint");
    grunt.loadNpmTasks("grunt-mocha-test");
    grunt.loadNpmTasks("grunt-prepare-install");
    
    // Project configuration.
    grunt.initConfig({
        pkg: grunt.file.readJSON("package.json"),
        lib_src: [ "lib/**/*.js" ],
        test_src: [ "test/**/*Test.js" ],
        jshint: {
            all: [
                "Gruntfile.js",
                "<%= lib_src %>",
                "<%= test_src %>",
            ],
            options: {
                // .jshintrc used to allow compatibility with editors without
                // grunt
                jshintrc: ".jshintrc"
            }
        },
        mochaTest: {
            test: {
                src: [ "<%= test_src %>" ]
            },
            xunit: { // for Jenkins
                src: [ "<%= test_src %>" ],
                options: {
                    reporter: "xunit",
                    quiet: true,
                    captureFile: path.join(targetDir, "xunit.xml")
                }
            }
        },
        prepare_install: {
            options: {
                tmpDir: targetDir,
                packageRoot: packageRoot,
                installPrefix: "/opt/flapjack/consul"
            }
        },
    });

    // define tasks
    grunt.registerTask("default", ["jshint", "test"]);
    grunt.registerTask("test", ["mochaTest:test"]);
    grunt.registerTask("ci", [
        "jshint",
        "test",
        "set-git-config",
        "prepare_install",
        "prepare-package",
        "rpm-package",
    ]);
    
    grunt.registerTask("set-git-config", function() {
        var done = this.async();
        
        Q.all([
            Q.ninvoke(grunt.util, "spawn", {cmd: "git", args: ["rev-parse", "--verify", "--short", "HEAD"]}),
            Q.ninvoke(grunt.util, "spawn", {cmd: "git", args: ["rev-parse", "--verify", "HEAD"]}),
            Q.ninvoke(grunt.util, "spawn", {cmd: "git", args: ["rev-parse", "--abbrev-ref", "HEAD"]}),
            Q.ninvoke(grunt.util, "spawn", {cmd: "git", args: ["show", "-s", "--format=%ct", "HEAD"]}),
            Q.ninvoke(grunt.util, "spawn", {cmd: "git", args: ["config", "remote.origin.url"]})
        ]).spread(function(hashShort, hash, ref, commitTime, remote) {
            grunt.config("git", {
                commit_id_abbrev: hashShort[0].stdout,
                commit_id:        hash[0].stdout,
                branch:           ref[0].stdout,
                commit_time:      new Date(parseInt(commitTime[0].stdout, 10) * 1000),
                remote_url:       remote[0].stdout
            });
        }).done(done, done);
    });
    
    grunt.registerTask("clean", function() {
        grunt.file.delete(targetDir);
    });
    
    // run "npm install $PWD".  This will be our install package, with full
    // binary modules.
    grunt.registerTask("prepare-package", "npm install", function() {
        this.requires("prepare_install");
    });
    
    // tar up the installed module; depends on prepare-package
    grunt.registerTask("tar-package", "create tarball", function() {
        this.requires("prepare-package");
        
        var done = this.async();
        
        grunt.util.spawn({
            cmd: "tar",
            args: [
                "-cz",
                "-f", path.join(targetDir, grunt.config.process("<%= pkg.name %>-<%= pkg.version %>.tar.gz")),
                "-C", packageRoot,
                "."
            ]
        }, function(err, result) {
            if (err) {
                throw err;
            }
            
            grunt.verbose.write(result);

            done();
        });
    });
    
    // create rpm with fpm; depends on prepare-package
    grunt.registerTask("rpm-package", "create RPM", function() {
        this.requires("prepare-package");
        this.requiresConfig("git");
        
        var done = this.async();
        
        var iteration = "1";
        var parsedVer = semver.parse(grunt.config().pkg.version);
        
        // "alpha" in "3.0.0-alpha"
        if (parsedVer.release) {
            // http://fedoraproject.org/wiki/Packaging:NamingGuidelines#Pre-Release_packages
            
            // could do <datestamp>git<shorthash>
            // or
            // 0.${BUILD_NUMBER}.<semver.release>
            // right now I like the hash. Think I'll do a combination
            
            iteration = grunt.template.process(
                "0.<%= build_num %>.<%= semver.release %>.<%= commit_time %>.<%= git.commit_id_abbrev %>",
                {
                    data: {
                        // development build; assume Jenkins
                        build_num: process.env.BUILD_NUMBER || 0,
                        
                        semver: parsedVer,
                        commit_time: grunt.template.date(grunt.config("git.commit_time"), "yyyymmddHHMM"),
                        git: grunt.config("git")
                    }
                }
            );
        }
        
        // don't replace rclive-backend; this disallows installation of rclive-
        // backend
        var fpmArgs = [
            "-s", "dir",
            "-t", "rpm",
            "-C", packageRoot,
            "--name", grunt.config().pkg.name,
            "--version", parsedVer.version,
            "--iteration", iteration,
        ];
        
        // we probably have a pkg.engines.node like ">= 0.10.14 < 0.11".  fpm
        // (well, RPM) requires separate depends like "nodejs >= 0.10.14" and
        // "nodejs < 0.11"
        if (grunt.config().pkg.engines && grunt.config().pkg.engines.node) {
            semver.parseRange(grunt.config().pkg.engines.node).forEach(function(range) {
                fpmArgs = fpmArgs.concat(["--depends", "nodejs " + range.semver]);
            });
        }
        
        fpmArgs.push(".");
        
        // just a little debug
        grunt.verbose.writeln("fpm args: " + fpmArgs.join(" "));
        
        grunt.util.spawn({
            cmd: "fpm",
            args: fpmArgs,
            opts: { cwd: targetDir }
        }, function(err, result) {
            if (err) {
                // fpm only outputs to stdout
                err.message = result.stdout;
                
                throw err;
            }
            
            done();
        });
    });
};
