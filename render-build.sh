set -o errexit

npm install

npm run build

PUPPETER_CACHE_DIR=/opt/render/.cache/puppeteer
mkdir -p $PUPPETER_CACHE_DIR

npx puppeteer browsers install chrome

if [[ ! -d $PUPPETER_CACHE_DIR ]]; then
    echo "...Copying Puppeteer Cache from Build Cache"
    cp -R /opt/render/project/src/.cache/puppeteer/chrome/ $PUPPETEER_CACHE_DIR
else
    echo "...Storing Puppeteer Cache in Build Cache"
    cp -R $PUPPETEER_CACHE_DIR /opt/render/project/src/.cache/puppeteer/chrome/
fi
