var argv        = require('yargs').argv
  , util        = require('util')
  , fs          = require('fs')
  , path        = require('path')
  , _           = require('underscore')
  , glob        = require('glob')
  , mkdirp      = require('mkdirp')
  , Promise     = require('bluebird')
  , async       = require('async')
  , config      = require('./config.json')
  , resx2json   = require('../resx2json')
  ;

function isRelative(p) {
    var normal = path.normalize(p);
    var absolute = path.resolve(p);
    return normal != absolute;
}

function single(file, culture, read_dir, targets, fallbacks, terminal) {
  var culture       = culture || file.split('/')[0]
    , read_uri      = isRelative(file)? path.join(read_dir, file) : file
    , culture_words = culture.split('-')
    , aliases       = [culture]
    // is this a language file (ex: 'en', 'ar' ...) or is it a specific culture file (ex: 'en-us', 'zh-hans' ...)
    , language      = culture_words.length == 1? culture_words[0] : undefined
    ;

  // if this is a language file; generate all the culture files as well
  if (language) {
    var cultures = _.where(config, { TwoLetterISOLanguageName : language });
    aliases = _.map(cultures, function(c){ return c.Name.toLowerCase(); });
  }
  
  return resx2json
    .main(read_uri, targets, undefined /*type*/, fallbacks)
    .then(function(texts){
      return Promise
        .resolve(aliases)
        .map(function(alias, index, arrayLength){
          return Promise
            .resolve(texts)
            .map(function(text){
              var write_to = path.join(text.dest, alias + '.js');
              return Promise.promisify(fs.writeFile)(write_to, text.text, 'utf8');
            })                        
        });
    })
    .then(function(){
      terminal && console.log(file + ' => ' + aliases.join(', '));
      return {
          aliases : aliases
      };
    })
    .catch(function(err){
      return {
          aliases : aliases
        , error   : err
      };
    });
}

function single_qps_ploc(file, read_dir, targets, fallbacks, terminal) {
  var read_uri = isRelative(file)? path.join(read_dir, file) : file;

  return resx2json
    .main_qps_ploc(read_uri, targets, undefined /*type*/, fallbacks)
    .then(function(texts){
      return Promise
        .resolve(texts)
        .map(function(text){
          var write_to = path.join(text.dest, 'qps-ploca.js');
          return Promise.promisify(fs.writeFile)(write_to, text.text, 'utf8');
        });
    })
    .then(function(){
      terminal && console.log(file + ' => qps-ploca');
      return {
          aliases : ['qps-ploca']
      };
    })
    .catch(function(err){
      return {
          aliases : ['qps-ploca']
        , error   : err
      };
    });
}

function main(i18n_glob /*glob pattern for lspkg files*/, read_dir /*cwd*/, targets /*targets: dest-whitelist pairs*/, fallbacks /*fallback hash*/, terminal /*is running within the terminal on its own*/) {
  return Promise
    .resolve(targets)                          
    .map(function(tg_item){
      return Promise.promisify(mkdirp)(tg_item.dest)
    })    
    .then(function(){
      return Promise.promisify(glob)(i18n_glob, {
          cwd       : read_dir || process.cwd()
        , nosort    : true
        , silent    : true
        , strict    : false
        , nonull    : false
      });
    })
    .then(function(files){
      var wl_p = resx2json.loadWhiteLists(targets);

      return Promise
        .resolve(files)
        .map(function(item, index, arrayLength){
          return wl_p.then(function(whiteLists){
            var ret = single(item, undefined, read_dir, whiteLists, fallbacks, terminal);

            if (item.indexOf('en') === 0) {
              ret = ret.then(function(){
                // generate qps-ploca
                return single_qps_ploc(item, read_dir, whiteLists, fallbacks, terminal);
              });
            }

            return ret;
          });
        });
    })
    .spread(function(){
      var failures = _.filter(arguments, function(item){
        return !!item.error;
      });

      // console.log(util.inspect(arguments, { depth : null, colors : true }));

      if (failures.length) {
        var cultures  = _.flatten(_.pluck(failures, 'aliases'))
          , text      = cultures.join(', ')
          ;

        throw _.extend(new Error('Failed to generate: ' + text), { inner : failures });
      }
    });
}

if (require.main === module) {
  main(argv.g, argv.r, argv.o, argv.w, fallbacks, true /*terminal*/)
    .then(function(res){
      console.log("=== DONE CONVERTING LOCALIZATION FILES ===");
    })
    .catch(function(err){
      console.error(err);
    });
}

module.exports = {
    main    : main
  , single  : single
};